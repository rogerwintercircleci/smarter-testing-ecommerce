import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { addMinutes, BASE_DATE, bulkInsert, productRow, seededRandom } from '../support/fixtures';
import { Product } from '../../../src/services/product-catalog/entities/product.entity';
import { Review } from '../../../src/services/product-catalog/entities/review.entity';
import { Order } from '../../../src/services/order-processing/entities/order.entity';
import { ProductRepository } from '../../../src/services/product-catalog/repositories/product.repository';
import { ReviewRepository } from '../../../src/services/product-catalog/repositories/review.repository';
import { OrderRepository } from '../../../src/services/order-processing/repositories/order.repository';
import { ReviewService } from '../../../src/services/product-catalog/services/review.service';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../../src/libs/errors';

/**
 * Reviews are seeded through the repository. ReviewService.createReview is only
 * exercised up to its validation steps: its verified-purchase lookup uses
 * MySQL-only JSON functions that fail on Postgres (reported separately).
 */
describe('Review ratings and aggregation (ReviewService + repositories, real Postgres)', () => {
  let ds: DataSource;
  let products: ProductRepository;
  let reviews: ReviewRepository;
  let service: ReviewService;

  beforeAll(async () => {
    ds = await createTestDatabase();
    products = new ProductRepository(ds.getRepository(Product));
    reviews = new ReviewRepository(ds.getRepository(Review));
    service = new ReviewService(reviews, products, new OrderRepository(ds.getRepository(Order)));
  });

  afterAll(async () => {
    await dropTestDatabase(ds);
  });

  beforeEach(async () => {
    await truncateAll(ds);
  });

  interface SeededReview {
    productId: string;
    userId: string;
    rating: number;
    title: string;
    comment: string;
    isVerifiedPurchase: boolean;
    helpfulCount: number;
    createdAt: Date;
  }

  async function seedReviews(productId: string, count: number, seed: number): Promise<SeededReview[]> {
    const rand = seededRandom(seed);
    const rows: SeededReview[] = Array.from({ length: count }, (_, i) => ({
      productId,
      userId: `user-${seed}-${i}`,
      rating: 1 + Math.floor(rand() * 5),
      title: `Review ${i}`,
      comment: 'Seeded review body',
      isVerifiedPurchase: rand() < 0.6,
      // i * 37 mod 1009 never repeats for i < 1009, so helpful counts are unique.
      helpfulCount: (i * 37) % 1009,
      createdAt: addMinutes(BASE_DATE, seed * 10000 + i),
    }));
    await bulkInsert(ds, Review, rows);
    return rows;
  }

  it('computes the average rating in SQL', async () => {
    const product = await products.createProduct(productRow(1));
    const seeded = await seedReviews(product.id, 240, 1);
    const expected = seeded.reduce((sum, r) => sum + r.rating, 0) / seeded.length;

    await expect(service.getAverageRating(product.id)).resolves.toBeCloseTo(expected, 10);
    await expect(service.getAverageRating('no-reviews')).resolves.toBe(0);
  });

  it('summarises count, average and star distribution', async () => {
    const product = await products.createProduct(productRow(1));
    const seeded = await seedReviews(product.id, 180, 2);
    const stars = (n: number) => seeded.filter((r) => r.rating === n).length;

    const summary = await service.getReviewSummary(product.id);

    expect(summary.totalReviews).toBe(180);
    expect(summary.averageRating).toBeCloseTo(
      seeded.reduce((sum, r) => sum + r.rating, 0) / 180,
      10
    );
    expect(summary.distribution).toEqual({
      fiveStars: stars(5),
      fourStars: stars(4),
      threeStars: stars(3),
      twoStars: stars(2),
      oneStars: stars(1),
    });
  });

  it('keeps each product’s reviews separate', async () => {
    const a = await products.createProduct(productRow(1));
    const b = await products.createProduct(productRow(2));
    await seedReviews(a.id, 60, 3);
    await seedReviews(b.id, 25, 4);

    expect(await service.getReviewCount(a.id)).toBe(60);
    expect(await service.getReviewCount(b.id)).toBe(25);
    const forB = await service.getProductReviews(b.id);
    expect(forB.every((r) => r.productId === b.id)).toBe(true);
  });

  it('filters, sorts and paginates product reviews', async () => {
    const product = await products.createProduct(productRow(1));
    const seeded = await seedReviews(product.id, 150, 5);
    const newestFirst = [...seeded].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());

    const all = await service.getProductReviews(product.id);
    expect(all.map((r) => r.userId)).toEqual(newestFirst.map((r) => r.userId));

    const fourPlus = await service.getProductReviews(product.id, { minRating: 4 });
    expect(fourPlus).toHaveLength(seeded.filter((r) => r.rating >= 4).length);

    const verified = await service.getProductReviews(product.id, { verifiedOnly: true });
    expect(verified).toHaveLength(seeded.filter((r) => r.isVerifiedPurchase).length);
    expect(verified.every((r) => r.isVerifiedPurchase)).toBe(true);

    const helpful = await service.getProductReviews(product.id, { sortBy: 'helpful' });
    const helpfulCounts = helpful.map((r) => r.helpfulCount);
    expect(helpfulCounts).toEqual([...helpfulCounts].sort((x, y) => y - x));

    const page3 = await service.getProductReviews(product.id, { page: 3, limit: 20 });
    expect(page3.map((r) => r.userId)).toEqual(newestFirst.slice(40, 60).map((r) => r.userId));
  });

  it('lists a user’s reviews across products, newest first', async () => {
    const productIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      productIds.push((await products.createProduct(productRow(i))).id);
    }
    for (const [i, productId] of productIds.entries()) {
      await reviews.create({ productId, userId: 'reviewer', rating: 3, createdAt: addMinutes(BASE_DATE, i) });
    }

    const mine = await service.getUserReviews('reviewer');
    expect(mine.map((r) => r.productId)).toEqual([...productIds].reverse());
  });

  it('counts helpful votes atomically and refuses self-votes', async () => {
    const product = await products.createProduct(productRow(1));
    const review = await reviews.create({ productId: product.id, userId: 'author', rating: 5 });

    await Promise.all(
      Array.from({ length: 25 }, (_, i) => service.markReviewAsHelpful(review.id, `voter-${i}`))
    );

    expect((await reviews.findById(review.id)).helpfulCount).toBe(25);
    await expect(service.markReviewAsHelpful(review.id, 'author')).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      service.markReviewAsHelpful('00000000-0000-4000-8000-000000000000', 'x')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets only the author edit a review and recalculates the product rating', async () => {
    const product = await products.createProduct(productRow(1));
    const mine = await reviews.create({ productId: product.id, userId: 'author', rating: 2 });
    await reviews.create({ productId: product.id, userId: 'other', rating: 4 });

    await expect(service.updateReview(mine.id, 'other', { rating: 5 })).rejects.toBeInstanceOf(
      UnauthorizedError
    );

    // (4 + 4) / 2 = 4: a whole-number average (see report on fractional averages).
    await service.updateReview(mine.id, 'author', { rating: 4, comment: 'Grew on me' });

    const stored = await reviews.findById(mine.id);
    expect(stored.rating).toBe(4);
    expect(stored.comment).toBe('Grew on me');
    const refreshed = await products.findById(product.id);
    expect(refreshed.rating).toBe(4);
    expect(refreshed.reviewCount).toBe(2);
  });

  it('lets only the author delete a review and recalculates the product rating', async () => {
    const product = await products.createProduct(productRow(1));
    const doomed = await reviews.create({ productId: product.id, userId: 'author', rating: 1 });
    await reviews.create({ productId: product.id, userId: 'b', rating: 5 });
    await reviews.create({ productId: product.id, userId: 'c', rating: 3 });

    await expect(service.deleteReview(doomed.id, 'b')).rejects.toBeInstanceOf(UnauthorizedError);

    await service.deleteReview(doomed.id, 'author');

    expect(await reviews.findByIdOrNull(doomed.id)).toBeNull();
    const refreshed = await products.findById(product.id);
    expect(refreshed.rating).toBe(4);
    expect(refreshed.reviewCount).toBe(2);
  });

  it('validates new reviews before any purchase lookup', async () => {
    const product = await products.createProduct(productRow(1));
    await reviews.create({ productId: product.id, userId: 'repeat', rating: 4 });

    await expect(
      service.createReview({ productId: product.id, userId: 'u', rating: 6 })
    ).rejects.toThrow('Rating must be between 1 and 5');
    await expect(
      service.createReview({ productId: '00000000-0000-4000-8000-000000000000', userId: 'u', rating: 4 })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.createReview({ productId: product.id, userId: 'repeat', rating: 2 })
    ).rejects.toThrow('You have already reviewed this product');
    expect(await reviews.countByProductId(product.id)).toBe(1);
  });
});

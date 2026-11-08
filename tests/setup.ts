const env = process.env as Record<string, string | undefined>;
env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/restro_test";
env.JWT_SECRET = "test-secret";
env.NODE_ENV = "test";
env.OTP_DEV_REVEAL = "true";
env.TZ = "Asia/Kolkata";
delete process.env.AGGREGATOR_WEBHOOK_SECRET;
delete process.env.RAZORPAY_KEY_ID;
delete process.env.STRIPE_SECRET_KEY;

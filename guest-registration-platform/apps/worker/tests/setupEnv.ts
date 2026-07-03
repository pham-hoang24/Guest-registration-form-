process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5433/guest_registration_test";
process.env.NODE_ENV = "test";

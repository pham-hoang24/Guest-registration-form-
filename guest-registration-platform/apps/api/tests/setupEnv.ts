import { TEST_DATABASE_URL } from "./testEnv.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = "test";

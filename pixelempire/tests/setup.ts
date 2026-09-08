import { config } from "dotenv";

// Loaded before any module that reads DATABASE_URL at import time.
config({ path: ".env.test", override: true });

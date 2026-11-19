// Vercel Function entry point. vercel.json rewrites every /api/* request here;
// Express sees the original URL and routes it as usual.
import { app } from '../server/app.js';

export default app;

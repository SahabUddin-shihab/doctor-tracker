export {};

declare global {
  namespace Express {
    interface Request {
      /** Output of the validate() middleware: { body, query, params } after Zod parsing. */
      validated?: unknown;
      /** Set by the authenticate() middleware. */
      admin?: { id: string; role: string };
    }
  }
}

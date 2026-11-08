import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

export class AppError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length ? issue.path.join(".") : "body";
      if (!fields[key]) fields[key] = issue.message;
    }
    throw new AppError(400, "validation", "Check the highlighted fields", fields);
  }
  return result.data;
}

export function asyncRoute(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function sendError(res: Response, error: unknown) {
  if (error instanceof AppError) {
    res.status(error.status).json({ ok: false, error: { code: error.code, message: error.message, fields: error.fields } });
    return;
  }
  const errWithStatus = error as { status?: number; statusCode?: number; message?: string };
  if (errWithStatus && typeof (errWithStatus.status || errWithStatus.statusCode) === "number") {
    res.status(errWithStatus.status || errWithStatus.statusCode || 400).json({ ok: false, error: { code: "bad_request", message: errWithStatus.message || "Bad request" } });
    return;
  }
  console.error(error);
  res.status(500).json({ ok: false, error: { code: "internal", message: error instanceof Error ? error.message : "Something went wrong. Please try again." } });
}

export function ok(res: Response, data: unknown, status = 200) {
  res.status(status).json({ ok: true, data });
}

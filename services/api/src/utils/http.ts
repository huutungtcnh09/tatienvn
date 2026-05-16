import type { Response } from "express";

export function ok(res: Response, data: unknown, message = "OK") {
  return res.status(200).json({ message, data });
}

export function created(res: Response, data: unknown, message = "Created") {
  return res.status(201).json({ message, data });
}

export function badRequest(res: Response, message: string) {
  return res.status(400).json({ message });
}

export function unauthorized(res: Response, message = "Unauthorized") {
  return res.status(401).json({ message });
}

export function forbidden(res: Response, message = "Forbidden") {
  return res.status(403).json({ message });
}

/**
 * Custom error classes for Twitch VOD Messages library
 */

/**
 * Error thrown when Client ID retrieval fails
 */
export class ClientIdRetrievalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientIdRetrievalError";
  }
}

/**
 * Error thrown when parsing Twitch GraphQL API response fails
 */
export class ResponseParseError extends Error {
  public readonly zodErrors?: unknown;

  constructor(message: string, zodErrors?: unknown) {
    super(message);
    this.name = "ResponseParseError";
    this.zodErrors = zodErrors;
  }
}

/**
 * Error thrown when HTTP request fails
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly url: string;

  constructor(statusCode: number, url: string, message?: string) {
    super(message ?? `HTTP error ${statusCode} for ${url}`);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.url = url;
  }
}

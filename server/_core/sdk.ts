import { AXIOS_TIMEOUT_MS, COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import type {
  GetUserInfoResponse,
  GitHubEmail,
  GitHubTokenResponse,
  GitHubUser,
} from "./types/githubOAuthTypes";

// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

class GitHubOAuthService {
  constructor() {
    if (!ENV.githubClientId || !ENV.githubClientSecret) {
      console.error(
        "[OAuth] ERROR: GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set."
      );
    }
  }

  /**
   * Exchange an authorization code for a GitHub access token.
   */
  async getTokenByCode(code: string): Promise<GitHubTokenResponse> {
    const { data } = await axios.post<GitHubTokenResponse>(
      GITHUB_TOKEN_URL,
      {
        client_id: ENV.githubClientId,
        client_secret: ENV.githubClientSecret,
        code,
      },
      {
        headers: { Accept: "application/json" },
        timeout: AXIOS_TIMEOUT_MS,
      }
    );
    return data;
  }

  /**
   * Fetch the authenticated GitHub user's profile.
   */
  async getUser(accessToken: string): Promise<GitHubUser> {
    const { data } = await axios.get<GitHubUser>(GITHUB_USER_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
      timeout: AXIOS_TIMEOUT_MS,
    });
    return data;
  }

  /**
   * Fetch the authenticated GitHub user's verified primary email.
   * Falls back to the email on the user profile if no primary verified address is found.
   */
  async getPrimaryEmail(
    accessToken: string,
    fallback: string | null
  ): Promise<string | null> {
    try {
      const { data } = await axios.get<GitHubEmail[]>(GITHUB_EMAILS_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
        timeout: AXIOS_TIMEOUT_MS,
      });
      const primary = data.find((e) => e.primary && e.verified);
      return primary?.email ?? fallback;
    } catch {
      return fallback;
    }
  }
}

class SDKServer {
  private readonly githubOAuth: GitHubOAuthService;

  constructor() {
    this.githubOAuth = new GitHubOAuthService();
  }

  /**
   * Exchange GitHub OAuth authorization code for an access token.
   * The `state` parameter is accepted for interface compatibility but is not
   * forwarded to GitHub (GitHub validates state client-side via the redirect).
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(
    code: string,
    _state: string
  ): Promise<GitHubTokenResponse> {
    return this.githubOAuth.getTokenByCode(code);
  }

  /**
   * Get user information from GitHub using an access token.
   * Maps GitHub fields to the internal GetUserInfoResponse shape.
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.access_token);
   */
  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    const ghUser = await this.githubOAuth.getUser(accessToken);
    const email = await this.githubOAuth.getPrimaryEmail(
      accessToken,
      ghUser.email
    );
    return {
      openId: String(ghUser.login),
      name: ghUser.name ?? ghUser.login,
      email: email ?? null,
      platform: "github",
      loginMethod: "github",
    };
  }

  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for a user's openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || "",
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{ openId: string; appId: string; name: string } | null> {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name } = payload as Record<string, unknown>;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        !isNonEmptyString(name)
      ) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }

      return {
        openId,
        appId,
        name,
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<User> {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    const signedInAt = new Date();
    const user = await db.getUserByOpenId(session.openId);

    if (!user) {
      throw ForbiddenError("User not found");
    }

    await db.upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt,
    });

    return user;
  }
}

export const sdk = new SDKServer();

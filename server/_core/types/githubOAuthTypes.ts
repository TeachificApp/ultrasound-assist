// GitHub OAuth TypeScript types

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

export interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

// Internal response type — kept compatible with the rest of the auth system
export interface GetUserInfoResponse {
  openId: string;
  name: string;
  email?: string | null;
  platform?: string | null;
  loginMethod?: string | null;
}

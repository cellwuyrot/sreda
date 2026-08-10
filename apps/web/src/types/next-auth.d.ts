import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      username: string;
      email: string;
      image?: string;
      role: string;
      isPremium: boolean;
      banned: boolean;
      bannedUntil: string | null;
      banReason: string | null;
    };
  }

  interface User {
    role: string;
    username: string;
    isPremium: boolean;
    banned: boolean;
    bannedUntil: string | null;
    banReason: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: string;
    id: string;
    username: string;
    isPremium: boolean;
    banned: boolean;
    bannedUntil: string | null;
    banReason: string | null;
  }
}

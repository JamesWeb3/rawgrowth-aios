import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifyPassword } from "@/lib/auth/password";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/auth/signin" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const { data: user } = await supabaseAdmin()
          .from("rgaios_users")
          .select("id, email, name, password_hash")
          .eq("email", email)
          .maybeSingle();

        if (!user?.password_hash) return null;
        const ok = await verifyPassword(password, user.password_hash);
        if (!ok) return null;

        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) session.user.id = token.id as string;
      return session;
    },
  },
});

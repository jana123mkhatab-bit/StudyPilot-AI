import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/jwt-edge";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/courses",
  "/assessments",
  "/knowledge",
  "/plan",
  "/techniques",
  "/settings",
  "/calendar",
  "/notifications",
  "/history",
  "/accountability",
  "/profile",
  "/progress",
  "/teacher",
  "/focus",
  "/professor",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!isProtected) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const studentId = await verifySessionToken(token);
  if (studentId) return NextResponse.next();

  const redirectUrl = new URL("/login", request.url);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/courses/:path*",
    "/assessments/:path*",
    "/knowledge/:path*",
    "/plan/:path*",
    "/techniques/:path*",
    "/settings/:path*",
    "/calendar/:path*",
    "/notifications/:path*",
    "/history/:path*",
    "/accountability/:path*",
    "/profile/:path*",
    "/progress/:path*",
    "/teacher/:path*",
    "/focus/:path*",
    "/professor/:path*",
  ],
};

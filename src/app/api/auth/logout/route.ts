import { ok } from "../../_lib/http";

export async function POST() {
  const response = ok({ loggedOut: true });
  response.cookies.set("nexo_token", "", { httpOnly: true, maxAge: 0, path: "/" });
  return response;
}

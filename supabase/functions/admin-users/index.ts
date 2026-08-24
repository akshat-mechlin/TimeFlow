import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Action =
  | "create"
  | "update"
  | "delete"
  | "recovery_link";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Server misconfigured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: isAdmin, error: adminError } = await userClient.rpc(
      "is_admin",
      { user_id: user.id },
    );
    if (adminError || !isAdmin) {
      return json({ error: "Forbidden: admin only" }, 403);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();
    const action = body.action as Action;

    switch (action) {
      case "create": {
        const { email, password, email_confirm = true } = body;
        if (!email || !password) {
          return json({ error: "email and password required" }, 400);
        }
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm,
        });
        if (error) return json({ error: error.message }, 400);
        return json({ user: data.user });
      }
      case "update": {
        const { user_id, email, password, email_confirm } = body;
        if (!user_id) return json({ error: "user_id required" }, 400);
        const updateData: Record<string, unknown> = {};
        if (email) {
          updateData.email = email;
          updateData.email_confirm = email_confirm ?? true;
        }
        if (password) updateData.password = password;
        const { data, error } = await admin.auth.admin.updateUserById(
          user_id,
          updateData,
        );
        if (error) return json({ error: error.message }, 400);
        return json({ user: data.user });
      }
      case "delete": {
        const { user_id } = body;
        if (!user_id) return json({ error: "user_id required" }, 400);
        const { error } = await admin.auth.admin.deleteUser(user_id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      case "recovery_link": {
        const { email } = body;
        if (!email) return json({ error: "email required" }, 400);
        const { data, error } = await admin.auth.admin.generateLink({
          type: "recovery",
          email,
        });
        if (error) return json({ error: error.message }, 400);
        return json({ data });
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

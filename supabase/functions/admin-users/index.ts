import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

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

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
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
        if (user_id === user.id) {
          return json({ error: "You cannot delete your own account" }, 400);
        }

        // Fast path: only soft-delete, then return. Auth ban + purge run in background.
        const { error: softError } = await admin.rpc("admin_soft_delete_user", {
          p_user_id: user_id,
        });
        if (softError) {
          return json({
            error: `Failed to delete user: ${softError.message}`,
          }, 400);
        }

        const background = (async () => {
          try {
            const deletedEmail = `deleted+${user_id}@deleted.local`;
            const { error: banError } = await admin.auth.admin.updateUserById(
              user_id,
              {
                email: deletedEmail,
                email_confirm: true,
                ban_duration: "876600h",
                user_metadata: {
                  deleted: true,
                  deleted_at: new Date().toISOString(),
                },
              },
            );
            if (banError) {
              console.error("ban/update auth failed", banError.message);
            }

            let done = false;
            for (let i = 0; i < 500 && !done; i++) {
              const { data: batch, error: purgeError } = await admin.rpc(
                "admin_purge_user_data_batch",
                { p_user_id: user_id },
              );
              if (purgeError) {
                await admin.from("user_deletion_jobs").upsert({
                  user_id,
                  status: "failed",
                  error: purgeError.message,
                  finished_at: new Date().toISOString(),
                });
                console.error("purge failed", purgeError.message);
                return;
              }
              done = Boolean(batch?.done);
            }

            if (!done) {
              await admin.from("user_deletion_jobs").upsert({
                user_id,
                status: "failed",
                error: "Purge did not finish within batch limit",
                finished_at: new Date().toISOString(),
              });
              return;
            }

            const { error: authDeleteError } = await admin.auth.admin
              .deleteUser(user_id);
            if (authDeleteError) {
              const msg = authDeleteError.message || "";
              if (!/not found|user not found|does not exist/i.test(msg)) {
                await admin.from("user_deletion_jobs").upsert({
                  user_id,
                  status: "auth_delete_failed",
                  error: msg,
                  finished_at: new Date().toISOString(),
                });
                console.error("auth delete failed", msg);
                return;
              }
            }

            await admin.from("user_deletion_jobs").upsert({
              user_id,
              status: "completed",
              finished_at: new Date().toISOString(),
              error: null,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("background delete failed", message);
            try {
              await admin.from("user_deletion_jobs").upsert({
                user_id,
                status: "failed",
                error: message,
                finished_at: new Date().toISOString(),
              });
            } catch {
              /* ignore */
            }
          }
        })();

        try {
          EdgeRuntime.waitUntil(background);
        } catch {
          background.catch(() => {});
        }

        return json({
          ok: true,
          mode: "soft_delete_then_background_purge",
          message:
            "User removed. Related data (screenshots, etc.) is being cleaned up in the background.",
        });
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

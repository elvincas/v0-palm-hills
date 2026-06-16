import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

serve(async (req) => {
  try {
    // Verificar que sea POST
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Obtener variables de entorno
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const dbPassword = Deno.env.get("DB_PASSWORD");
    const dbUrl = Deno.env.get("DATABASE_URL");

    if (!supabaseUrl || !supabaseServiceKey || !dbUrl) {
      return new Response(
        JSON.stringify({ error: "Missing environment variables" }),
        { status: 500 }
      );
    }

    // Crear cliente de Supabase
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Timestamp para el archivo
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").split("T")[0] +
      "_" +
      now.getHours().toString().padStart(2, "0") +
      "-" +
      now.getMinutes().toString().padStart(2, "0");

    // Ejecutar pg_dump para hacer el backup
    const command = new Deno.Command("pg_dump", {
      args: [
        dbUrl,
        "--format=plain",
        "--no-owner",
        "--no-privileges",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();
    const output = await process.output();

    if (!output.success) {
      const errorText = new TextDecoder().decode(output.stderr);
      console.error("pg_dump error:", errorText);
      return new Response(
        JSON.stringify({ error: "Backup failed", details: errorText }),
        { status: 500 }
      );
    }

    // Convertir output a blob
    const backupData = output.stdout;

    // Crear bucket si no existe
    const { data: buckets } = await supabase.storage.listBuckets();
    const backupBucketExists = buckets?.some((b) => b.name === "backups");

    if (!backupBucketExists) {
      await supabase.storage.createBucket("backups", { public: false });
    }

    // Guardar archivo en storage
    const filename = `backup_${timestamp}.sql`;
    const { data, error: uploadError } = await supabase.storage
      .from("backups")
      .upload(filename, backupData, { upsert: false });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(
        JSON.stringify({ error: "Upload failed", details: uploadError }),
        { status: 500 }
      );
    }

    // Limpiar backups antiguos (mantener últimos 7 días)
    const { data: files } = await supabase.storage
      .from("backups")
      .list();

    if (files) {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const filesToDelete = files.filter(
        (f) =>
          new Date(f.created_at || "") < sevenDaysAgo &&
          f.name !== filename
      );

      if (filesToDelete.length > 0) {
        await supabase.storage
          .from("backups")
          .remove(filesToDelete.map((f) => f.name));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        filename,
        timestamp,
        message: "Backup creado exitosamente",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Backup function error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 }
    );
  }
});

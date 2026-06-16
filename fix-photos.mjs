import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fpzurpkszplgqarpozmt.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwenVycGtzenBsZ3FhcnBvem10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MDgzODEsImV4cCI6MjA5Njk4NDM4MX0.Pm03gMAgckWZTiy4fSQwcKa9LR3oHwWRYH52eTWx6Ek';

const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
  console.log('[v0] Fetching all clients...');
  const { data: clientes, error } = await supabase
    .from('clientes')
    .select('id, nom, foto_local');

  if (error) {
    console.error('[v0] Error fetching:', error);
    return;
  }

  console.log('[v0] Found ' + clientes.length + ' clients');
  
  for (const cliente of clientes) {
    if (cliente.foto_local) {
      const size = cliente.foto_local.length;
      console.log(`- ${cliente.nom}: ${Math.round(size / 1024)}KB`);
      
      // Si la foto es > 100KB (dato URL corrupta), limpiarla
      if (size > 100000) {
        console.log(`  ⚠️  LARGE! Clearing...`);
        const { error: updateError } = await supabase
          .from('clientes')
          .update({ foto_local: null })
          .eq('id', cliente.id);
        
        if (updateError) {
          console.error(`  Error clearing: ${updateError.message}`);
        } else {
          console.log(`  ✓ Cleared`);
        }
      }
    } else {
      console.log(`- ${cliente.nom}: NO PHOTO`);
    }
  }
  
  console.log('[v0] Done!');
})();

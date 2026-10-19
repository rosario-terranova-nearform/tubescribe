import { useSettings } from '@/api/settings.ts';
import { SettingsForm } from '@/components/SettingsForm.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { CheckCircle2, XCircle } from 'lucide-react';

export function SettingsPage() {
  const settingsQuery = useSettings();

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card className="flex max-w-2xl flex-row items-start gap-3 p-4">
        {settingsQuery.data?.openrouterKeyConfigured ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        )}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">OpenRouter API key</span>
          <p className="text-xs text-muted-foreground">
            The key is configured server-side via <code>OPENROUTER_API_KEY</code> in the server's
            <code>.env</code> file — it is never sent to this UI.
          </p>
          {settingsQuery.data && (
            <p className="text-xs">
              {settingsQuery.data.openrouterKeyConfigured ? (
                <span className="text-green-600">Configured</span>
              ) : (
                <span className="font-medium text-destructive">
                  Not configured — chat and embeddings will fail until it is set.
                </span>
              )}
            </p>
          )}
        </div>
      </Card>

      {settingsQuery.isPending && (
        <div className="flex max-w-2xl flex-col gap-4" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}
      {settingsQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load settings: {settingsQuery.error.message}
        </p>
      )}
      {settingsQuery.data && <SettingsForm settings={settingsQuery.data.settings} />}
    </section>
  );
}

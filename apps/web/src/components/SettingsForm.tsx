import { ApiRequestError } from '@/api/client.ts';
import { useUpdateSettings } from '@/api/settings.ts';
import { ModelPicker } from '@/components/ModelPicker.tsx';
import { Button } from '@/components/ui/button.tsx';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Settings, UpdateSettingsRequest } from '@tubescribe/shared';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';

/**
 * Form-level schema: the model fields of the shared SettingsSchema, but
 * non-nullable — the settings page always picks concrete models (null only
 * ever means "fall back to the env default", which the pickers surface as a
 * concrete choice). Submit payloads satisfy UpdateSettingsRequest.
 */
const settingsFormSchema = z.object({
  defaultChatModel: z.string().min(1, 'Pick a default chat model'),
  defaultEmbeddingModel: z.string().min(1, 'Pick a default embedding model'),
});
type SettingsFormValues = z.infer<typeof settingsFormSchema>;

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) {
    const reason = err.details?.reason;
    return typeof reason === 'string' ? `${err.message}: ${reason}` : err.message;
  }
  return fallback;
}

/** Default model pickers persisted via PUT /api/settings. */
export function SettingsForm({ settings }: { settings: Settings }) {
  const updateSettings = useUpdateSettings();
  const busy = updateSettings.isPending;

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      defaultChatModel: settings.defaultChatModel ?? '',
      defaultEmbeddingModel: settings.defaultEmbeddingModel ?? '',
    },
  });
  const errors = form.formState.errors;
  const embeddingModel = form.watch('defaultEmbeddingModel');
  const embeddingChanged = embeddingModel !== (settings.defaultEmbeddingModel ?? '');

  const onSubmit = form.handleSubmit((values) => {
    const payload = values satisfies UpdateSettingsRequest;
    updateSettings.mutate(payload, {
      onSuccess: (data) => {
        form.reset({
          defaultChatModel: data.settings.defaultChatModel ?? '',
          defaultEmbeddingModel: data.settings.defaultEmbeddingModel ?? '',
        });
        toast.success('Settings saved');
      },
      onError: (err) =>
        form.setError('root.server', {
          type: 'server',
          message: errorMessage(err, 'Could not save settings'),
        }),
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Default chat model</span>
        <Controller
          control={form.control}
          name="defaultChatModel"
          render={({ field }) => (
            <ModelPicker
              value={field.value || null}
              onChange={(id) => field.onChange(id ?? '')}
              disabled={busy}
              allowDefault={false}
              label="Chat model"
            />
          )}
        />
        <p className="text-xs text-muted-foreground">
          Used by every bot without its own model override.
        </p>
        {errors.defaultChatModel && (
          <p role="alert" className="text-sm text-destructive">
            {errors.defaultChatModel.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Default embedding model</span>
        <Controller
          control={form.control}
          name="defaultEmbeddingModel"
          render={({ field }) => (
            <ModelPicker
              value={field.value || null}
              onChange={(id) => field.onChange(id ?? '')}
              disabled={busy}
              type="embedding"
              allowDefault={false}
              label="Embedding model"
            />
          )}
        />
        {embeddingChanged && (
          <p
            role="alert"
            className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-foreground"
          >
            Changing the embedding model only affects sources embedded afterwards — existing chunks
            keep the old vectors.{' '}
            <Link to="/sources" className="font-medium underline">
              Reindex all sources
            </Link>{' '}
            after saving for retrieval to use the new model.
          </p>
        )}
        {errors.defaultEmbeddingModel && (
          <p role="alert" className="text-sm text-destructive">
            {errors.defaultEmbeddingModel.message}
          </p>
        )}
      </div>

      {errors.root?.server && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.server.message}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  );
}

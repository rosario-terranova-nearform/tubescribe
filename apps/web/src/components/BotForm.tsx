import { useCreateBot, useUpdateBot } from '@/api/bots.ts';
import { ApiRequestError } from '@/api/client.ts';
import { useSources } from '@/api/sources.ts';
import { ModelPicker } from '@/components/ModelPicker.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Bot, CreateBotRequest } from '@tubescribe/shared';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';

/**
 * Form-level schema: the same fields as the shared CreateBotRequestSchema,
 * but stricter where the UI demands it — the server defaults systemPrompt to
 * '' and sourceIds to [], while the form requires a non-empty prompt and at
 * least one attached source. Submit payloads still satisfy CreateBotRequest.
 */
const botFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  systemPrompt: z.string().trim().min(1, 'System prompt is required'),
  modelOverride: z.string().min(1).nullable(),
  sourceIds: z.array(z.string().min(1)).min(1, 'Attach at least one source'),
});
type BotFormValues = z.infer<typeof botFormSchema>;

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) {
    const reason = err.details?.reason;
    return typeof reason === 'string' ? `${err.message}: ${reason}` : err.message;
  }
  return fallback;
}

/**
 * Shared create/edit form for bots. `bot` present → edit mode (PUT, with
 * `modelOverride: null` clearing the override); absent → create (POST).
 */
export function BotForm({ bot }: { bot?: Bot }) {
  const navigate = useNavigate();
  const sourcesQuery = useSources();
  const createBot = useCreateBot();
  const updateBot = useUpdateBot(bot?.id ?? '');
  const busy = createBot.isPending || updateBot.isPending;

  const form = useForm<BotFormValues>({
    resolver: zodResolver(botFormSchema),
    defaultValues: {
      name: bot?.name ?? '',
      systemPrompt: bot?.systemPrompt ?? '',
      modelOverride: bot?.modelOverride ?? null,
      sourceIds: bot?.sourceIds ?? [],
    },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => {
    const payload = values satisfies CreateBotRequest;
    const onError = (err: Error) =>
      form.setError('root.server', {
        type: 'server',
        message: errorMessage(err, bot ? 'Could not save the bot' : 'Could not create the bot'),
      });
    if (bot) {
      updateBot.mutate(payload, {
        onSuccess: () => {
          toast.success('Bot updated');
          navigate('/bots');
        },
        onError,
      });
    } else {
      createBot.mutate(payload, {
        onSuccess: (data) => {
          toast.success('Bot created');
          navigate(`/bots/${data.bot.id}`);
        },
        onError,
      });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="bot-name" className="text-sm font-medium">
          Name
        </label>
        <Input
          id="bot-name"
          {...form.register('name')}
          aria-invalid={errors.name ? true : undefined}
          disabled={busy}
        />
        {errors.name && (
          <p role="alert" className="text-sm text-destructive">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="bot-system-prompt" className="text-sm font-medium">
          System prompt
        </label>
        <Textarea
          id="bot-system-prompt"
          rows={6}
          placeholder="You answer questions about my YouTube corpus…"
          {...form.register('systemPrompt')}
          aria-invalid={errors.systemPrompt ? true : undefined}
          disabled={busy}
        />
        {errors.systemPrompt && (
          <p role="alert" className="text-sm text-destructive">
            {errors.systemPrompt.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Model</span>
        <Controller
          control={form.control}
          name="modelOverride"
          render={({ field }) => (
            <ModelPicker value={field.value} onChange={field.onChange} disabled={busy} />
          )}
        />
        <p className="text-xs text-muted-foreground">
          “Default” uses the global chat model from Settings.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Sources</legend>
        {sourcesQuery.isPending && (
          <p className="text-sm text-muted-foreground">Loading sources…</p>
        )}
        {sourcesQuery.isError && (
          <p role="alert" className="text-sm text-destructive">
            Could not load sources: {sourcesQuery.error.message}
          </p>
        )}
        {sourcesQuery.data?.sources.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No sources yet —{' '}
            <Link to="/sources" className="font-medium underline">
              add a source
            </Link>{' '}
            before creating a bot.
          </p>
        )}
        <Controller
          control={form.control}
          name="sourceIds"
          render={({ field }) => (
            <ul className="flex flex-col gap-2">
              {sourcesQuery.data?.sources.map((source) => (
                <li key={source.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`bot-source-${source.id}`}
                    checked={field.value.includes(source.id)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked === true
                          ? [...field.value, source.id]
                          : field.value.filter((id) => id !== source.id),
                      )
                    }
                  />
                  <label
                    htmlFor={`bot-source-${source.id}`}
                    className="flex min-w-0 items-center gap-2 text-sm"
                  >
                    <span className="truncate">{source.title}</span>
                    <Badge variant="secondary">{source.kind}</Badge>
                  </label>
                </li>
              ))}
            </ul>
          )}
        />
        {errors.sourceIds && (
          <p role="alert" className="text-sm text-destructive">
            {errors.sourceIds.message}
          </p>
        )}
      </fieldset>

      {errors.root?.server && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.server.message}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : bot ? 'Save changes' : 'Create bot'}
        </Button>
        <Button type="button" variant="ghost" asChild>
          <Link to="/bots">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

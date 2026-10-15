import { ApiRequestError } from '@/api/client.ts';
import { useCreateSource, useResolveSource, useSources } from '@/api/sources.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  DEFAULT_TYPE_FILTER,
  type ResolvedSourceSuggestion,
  type SourceTypeFilter,
} from '@tubescribe/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';

const inputSchema = z.object({
  input: z.string().trim().min(1, 'Paste a YouTube channel, playlist, or video link'),
});
type InputValues = z.infer<typeof inputSchema>;

const TYPE_FILTER_KEYS = ['uploads', 'shorts', 'live'] as const;

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) {
    const reason = err.details?.reason;
    return typeof reason === 'string' ? `${err.message}: ${reason}` : err.message;
  }
  return fallback;
}

/**
 * The smart-paste flow: input → POST /api/sources/resolve → confirmation card
 * (kind, title, thumbnail, video count, type filter) → POST /api/sources.
 * Invalid input (400) renders inline under the input; duplicates (pre-flight
 * flag or 409) render a warning with a link to the existing source.
 */
export function AddSourceBox() {
  const navigate = useNavigate();
  const [suggestion, setSuggestion] = useState<ResolvedSourceSuggestion | null>(null);
  const [typeFilter, setTypeFilter] = useState<SourceTypeFilter>({ ...DEFAULT_TYPE_FILTER });
  const [conflict, setConflict] = useState(false);

  const form = useForm<InputValues>({
    resolver: zodResolver(inputSchema),
    defaultValues: { input: '' },
  });

  // Already cached when the box sits on /sources; used to link duplicates to
  // the existing source's detail page.
  const sourcesQuery = useSources();
  const resolveMutation = useResolveSource();
  const createMutation = useCreateSource();

  const busy = resolveMutation.isPending || createMutation.isPending;
  const duplicate = conflict || (suggestion?.duplicate ?? false);
  const existing = duplicate
    ? sourcesQuery.data?.sources.find(
        (s) => s.kind === suggestion?.kind && s.identifier === suggestion?.identifier,
      )
    : undefined;

  const reset = () => {
    setSuggestion(null);
    setConflict(false);
    setTypeFilter({ ...DEFAULT_TYPE_FILTER });
    form.reset();
  };

  const onSubmit = form.handleSubmit(({ input }) => {
    setSuggestion(null);
    setConflict(false);
    resolveMutation.mutate(input, {
      onSuccess: (data) => setSuggestion(data.suggestion),
      onError: (err) =>
        form.setError('input', {
          type: 'server',
          message: errorMessage(err, 'Could not resolve that input'),
        }),
    });
  });

  const onAdd = () => {
    if (!suggestion) return;
    createMutation.mutate(
      { kind: suggestion.kind, identifier: suggestion.identifier, typeFilter },
      {
        onSuccess: (data) => {
          toast.success('Source added — extraction started');
          reset();
          navigate(`/sources/${data.source.id}`);
        },
        onError: (err) => {
          if (err instanceof ApiRequestError && err.status === 409) setConflict(true);
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a source</CardTitle>
        <CardDescription>Paste a YouTube channel, playlist, or video link.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="flex items-start gap-2" noValidate>
          <Input
            {...form.register('input')}
            placeholder="https://www.youtube.com/@handle, playlist, or video…"
            aria-label="YouTube source link"
            aria-invalid={form.formState.errors.input ? true : undefined}
            disabled={busy}
            className="flex-1"
          />
          <Button type="submit" disabled={busy}>
            {resolveMutation.isPending ? 'Resolving…' : 'Add'}
          </Button>
        </form>
        {form.formState.errors.input && (
          <p role="alert" className="text-sm text-destructive">
            {form.formState.errors.input.message}
          </p>
        )}

        {suggestion && (
          <div className="flex flex-col gap-4 rounded-lg border p-4" data-testid="source-preview">
            <div className="flex items-start gap-3">
              {suggestion.thumbnailUrl && (
                <img
                  src={suggestion.thumbnailUrl}
                  alt=""
                  className="size-16 shrink-0 rounded-md bg-muted object-cover"
                />
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{suggestion.kind}</Badge>
                  {suggestion.videoCount != null && (
                    <span className="text-xs text-muted-foreground">
                      {suggestion.videoCount} videos
                    </span>
                  )}
                </div>
                <p className="font-medium">{suggestion.title ?? suggestion.identifier}</p>
              </div>
            </div>

            {duplicate && (
              <p role="alert" className="text-sm text-destructive">
                This source is already in your library.{' '}
                <Link
                  to={existing ? `/sources/${existing.id}` : '/sources'}
                  className="font-medium underline"
                >
                  View existing source
                </Link>
              </p>
            )}

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Include</legend>
              <div className="flex flex-wrap gap-4">
                {TYPE_FILTER_KEYS.map((key) => (
                  <span key={key} className="flex items-center gap-2">
                    <Checkbox
                      id={`type-filter-${key}`}
                      checked={typeFilter[key]}
                      onCheckedChange={(checked) =>
                        setTypeFilter((prev) => ({ ...prev, [key]: checked === true }))
                      }
                    />
                    <label htmlFor={`type-filter-${key}`} className="text-sm capitalize">
                      {key}
                    </label>
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                The type filter is fixed when the source is added — changing it later means
                re-adding the source.
              </p>
            </fieldset>

            {createMutation.isError && !conflict && (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage(createMutation.error, 'Could not add the source')}
              </p>
            )}

            <div className="flex gap-2">
              <Button onClick={onAdd} disabled={duplicate || busy}>
                {createMutation.isPending ? 'Adding…' : 'Add source'}
              </Button>
              <Button variant="ghost" onClick={reset} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

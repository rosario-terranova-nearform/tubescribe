import { type ModelType, useModels } from '@/api/models.ts';
import { useSettings } from '@/api/settings.ts';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { cn } from '@/lib/utils.ts';
import { DEFAULT_SETTINGS, type Model } from '@tubescribe/shared';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useState } from 'react';

interface ModelPickerProps {
  /** Selected model id; `null` means "use the global default" (allowDefault) or "no selection". */
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  /** Which catalog to browse (chat is the default). */
  type?: ModelType;
  /** Show the "Default (…)" null option (bot forms); hide it where a concrete model is required (settings). */
  allowDefault?: boolean;
  /** Accessible label for the trigger/listbox. */
  label?: string;
}

function modelLabel(model: Model): string {
  return model.name === model.id ? model.id : `${model.name} (${model.id})`;
}

/**
 * Searchable combobox over GET /api/models (the chat catalog). The model list
 * is fetched lazily on first open and cached for 1 h, matching the server's
 * catalog cache. The empty selection means "use the global default", and its
 * label shows what that default currently is.
 */
export function ModelPicker({
  value,
  onChange,
  disabled,
  type = 'chat',
  allowDefault = true,
  label = 'Chat model',
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const settingsQuery = useSettings();
  const modelsQuery = useModels({ enabled: open, type });

  const defaultModel =
    settingsQuery.data?.settings.defaultChatModel ?? DEFAULT_SETTINGS.defaultChatModel;
  const models = modelsQuery.data?.models ?? [];

  const needle = query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(needle);
  const filtered = needle ? models.filter((m) => matches(m.id) || matches(m.name)) : models;
  const showDefault = allowDefault && (!needle || matches('default') || matches(defaultModel));

  const selected = value == null ? null : models.find((m) => m.id === value);
  const triggerLabel =
    value == null
      ? allowDefault
        ? `Default (${defaultModel})`
        : 'Select a model…'
      : selected
        ? modelLabel(selected)
        : value;

  const select = (next: string | null) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          // biome-ignore lint/a11y/useSemanticElements: combobox trigger — a native <select> cannot host search or an async-loading catalog
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-w-[calc(100vw-2rem)]">
        <div className="flex flex-col gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search models…"
            aria-label="Search models"
          />
          {modelsQuery.isPending && (
            <p className="px-1 py-2 text-sm text-muted-foreground">Loading models…</p>
          )}
          {modelsQuery.isError && (
            <div className="flex flex-col gap-2 px-1 py-2">
              <p role="alert" className="text-sm text-destructive">
                Could not load models: {modelsQuery.error.message}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => modelsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          )}
          {modelsQuery.isSuccess && models.length === 0 && (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              No models available — the catalog is empty.
            </p>
          )}
          {modelsQuery.isSuccess && models.length > 0 && filtered.length === 0 && !showDefault && (
            <p className="px-1 py-2 text-sm text-muted-foreground">No models match “{query}”.</p>
          )}
          {modelsQuery.isSuccess && models.length > 0 && (filtered.length > 0 || showDefault) && (
            // biome-ignore lint/a11y/useSemanticElements: listbox popup of the combobox pattern — no semantic HTML equivalent
            // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the search input; options are tabbable buttons
            <div
              role="listbox"
              aria-label={`${label}s`}
              className="flex max-h-64 flex-col gap-0.5 overflow-y-auto"
            >
              {showDefault && (
                <button
                  type="button"
                  // biome-ignore lint/a11y/useSemanticElements: role="option" is part of the combobox listbox pattern
                  role="option"
                  aria-selected={value == null}
                  onClick={() => select(null)}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <CheckIcon
                    className={cn('size-4 shrink-0', value == null ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="truncate">Default ({defaultModel})</span>
                </button>
              )}
              {filtered.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  // biome-ignore lint/a11y/useSemanticElements: role="option" is part of the combobox listbox pattern
                  role="option"
                  aria-selected={value === model.id}
                  onClick={() => select(model.id)}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <CheckIcon
                    className={cn(
                      'size-4 shrink-0',
                      value === model.id ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{model.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {model.id}
                      {model.contextLength != null &&
                        ` · ${Math.round(model.contextLength / 1000)}k context`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

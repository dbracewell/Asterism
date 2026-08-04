import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/features/theme/components/theme-context";
import { loadTheme, saveTheme } from "@/features/theme/server/actions";
import { Theme } from "@/features/theme/types";
import { prettyText } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CopyPlusIcon,
  LoaderCircleIcon,
  PaletteIcon,
  PlusIcon,
  SaveIcon,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { HexColorPicker } from "react-colorful";
import { Controller, ControllerRenderProps, useForm } from "react-hook-form";
import z from "zod";

export const ThemeEditor = () => {
  const { lightThemes, darkThemes } = useTheme();
  const [theme, setTheme] = useState<Theme | null>(null);

  return (
    <div className="flex h-full flex-1 flex-col">
      <div className="relative flex items-center gap-2 border-b pb-2">
        <h1 className="text-base font-bold">Theme Editor</h1>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Add provider"
          className="absolute top-0 right-0"
          onClick={() => setTheme(prepareFormData({}))}
        >
          <PlusIcon />
        </Button>
      </div>
      <div className="flex h-full min-h-0 flex-1 items-start gap-2 overflow-hidden">
        <div className="flex h-full w-60 flex-col gap-1 overflow-y-auto py-2">
          {lightThemes.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <h2 className="text-muted-foreground text-sm font-medium">
                Light
              </h2>
              {lightThemes.map((t) => (
                <ThemeButton
                  key={t.filename}
                  theme={t}
                  setTheme={setTheme}
                  currentTheme={theme?.name}
                />
              ))}
            </div>
          )}
          <div className="h-3 w-full" />
          {darkThemes.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <h2 className="text-muted-foreground text-sm font-medium">
                Dark
              </h2>
              {darkThemes.map((t) => (
                <ThemeButton
                  key={t.filename}
                  theme={t}
                  setTheme={setTheme}
                  currentTheme={theme?.name}
                />
              ))}
            </div>
          )}
        </div>
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <ThemeForm theme={theme ?? undefined} setTheme={setTheme} />
        </div>
      </div>
    </div>
  );
};

const ThemeButton = ({
  theme,
  setTheme,
  currentTheme,
}: {
  theme: {
    name: string;
    filename: string;
    type: "light" | "dark";
  };
  setTheme: (theme: Theme) => void;
  currentTheme?: string;
}) => {
  return (
    <div className="flex items-center justify-between gap-1">
      <Button
        className={cn(
          "flex-1 justify-start! truncate rounded-md p-0.5! text-left! text-xs",
          currentTheme === theme.name && "bg-accent text-accent-foreground",
        )}
        variant="ghost"
        onClick={async () => {
          const t = await loadTheme(theme.filename);
          setTheme(t);
        }}
      >
        {theme.name}
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={async () => {
          const t = await loadTheme(theme.filename);
          setTheme({
            ...t,
            filename: "",
            name: `${t.name} Copy`,
          });
        }}
      >
        <CopyPlusIcon />
      </Button>
    </div>
  );
};

const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: "Invalid hex color",
});

const ThemeColorsSchema = z.object({
  background: hexColor,
  foreground: hexColor,
  card: hexColor,
  "card-foreground": hexColor,
  popover: hexColor,
  "popover-foreground": hexColor,
  primary: hexColor,
  "primary-foreground": hexColor,
  secondary: hexColor,
  "secondary-foreground": hexColor,
  muted: hexColor,
  "muted-foreground": hexColor,
  accent: hexColor,
  "accent-foreground": hexColor,
  destructive: hexColor,
  border: hexColor,
  input: hexColor,
  ring: hexColor,
  "chart-1": hexColor,
  "chart-2": hexColor,
  "chart-3": hexColor,
  "chart-4": hexColor,
  "chart-5": hexColor,
  sidebar: hexColor,
  "sidebar-foreground": hexColor,
  "sidebar-primary": hexColor,
  "sidebar-primary-foreground": hexColor,
  "sidebar-accent": hexColor,
  "sidebar-accent-foreground": hexColor,
  "sidebar-border": hexColor,
  "sidebar-ring": hexColor,
});

const ThemeSchema = z.object({
  name: z.string().trim().min(1, "A theme name is require"),
  filename: z.string(),
  type: z.enum(["dark", "light"]),
  colors: ThemeColorsSchema,
});

type ThemeFormValues = z.infer<typeof ThemeSchema>;
type ThemeColorKey = keyof typeof ThemeColorsSchema.shape;
type ColorPath = `colors.${ThemeColorKey}`;

const prepareFormData = ({ theme }: { theme?: Theme }) => {
  if (theme) {
    return theme;
  }
  const entries = (Object.keys(ThemeColorsSchema.shape) as ThemeColorKey[]).map(
    (key) => [key, "#ffffff"],
  );
  return {
    type: "light",
    filename: "",
    name: "",
    colors: Object.fromEntries(entries),
  } as ThemeFormValues;
};

const ThemeForm = ({
  theme,
  setTheme,
}: {
  theme?: Theme;
  setTheme: (theme: Theme) => void;
}) => {
  const form = useForm<ThemeFormValues>({
    resolver: zodResolver(ThemeSchema),
    defaultValues: {
      ...prepareFormData({ theme }),
    },
  });

  const { control, handleSubmit, register, reset } = form;

  useEffect(() => {
    reset({
      ...prepareFormData({ theme }),
    });
  }, [theme, reset]);

  const [isPending, startTransition] = useTransition();

  const onSubmit = (values: ThemeFormValues) => {
    startTransition(async () => {
      await saveTheme(values);
    });
  };

  if (theme == null) {
    return (
      <div className="text-muted-foreground bg-card m-3 flex flex-1 flex-col items-center justify-center gap-3 rounded border border-dashed p-4 text-sm">
        <PaletteIcon className="text-muted-foreground/30 size-10" />
        <h4 className="w-sm text-center text-xl">
          Select a current theme or create a new one.
        </h4>
        <Button onClick={() => setTheme(prepareFormData({}))}>
          <PlusIcon /> New Theme
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      id="form-theme"
      className="flex min-h-0 flex-1 flex-col p-2"
    >
      <div className="@container flex flex-1 flex-col overflow-y-auto">
        <Input type="hidden" {...register("filename")} />
        <FieldGroup>
          <Controller
            control={control}
            name="name"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="form-theme-name">Name</FieldLabel>
                <Input
                  {...field}
                  id="form-theme-name"
                  aria-invalid={fieldState.invalid}
                  placeholder="Theme Name"
                  autoComplete="off"
                  required
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
          <Controller
            control={control}
            name="type"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldContent>
                  <FieldLabel htmlFor="form-theme-type">Type</FieldLabel>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </FieldContent>
                <Select
                  name={field.name}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger
                    id="form-theme-type"
                    aria-invalid={fieldState.invalid}
                    className="min-w-30"
                  >
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent position="item-aligned">
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 @md:grid-cols-2 @lg:grid-cols-3 @xl:grid-cols-4">
            {(Object.keys(ThemeColorsSchema.shape) as ThemeColorKey[]).map(
              (property) => (
                <Controller
                  key={property}
                  control={control}
                  name={`colors.${property}` as ColorPath}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="form-theme-name">
                        {prettyText(property)}
                      </FieldLabel>
                      <PopoverPicker
                        field={field}
                        isInvalid={fieldState.invalid}
                        id={`form-theme-color-${property}`}
                      />
                    </Field>
                  )}
                />
              ),
            )}
          </div>
        </FieldGroup>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button type="submit" disabled={isPending || !form.formState.isDirty}>
          {isPending ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <SaveIcon />
          )}
          Save
        </Button>
      </div>
    </form>
  );
};

interface ColorInputProps {
  field: ControllerRenderProps<ThemeFormValues, ColorPath>;
  id: string;
  isInvalid: boolean;
}

export const PopoverPicker = ({ field, id, isInvalid }: ColorInputProps) => {
  return (
    <Popover>
      <PopoverTrigger>
        <div
          className="bg-background flex h-10 w-full items-center justify-center text-xs"
          style={{ backgroundColor: field.value }}
        >
          {field.value == null && "Not Selected"}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-fit! border p-1! py-3!">
        <div className="flex flex-col items-center gap-y-4">
          <HexColorPicker
            id={id}
            {...field}
            color={field.value}
            aria-invalid={isInvalid}
            onChange={field.onChange}
          />
          <div className="flex max-w-[95%] items-center justify-between gap-1">
            <Input
              {...field}
              required
              className="focus-visible: focus-visible:border-border h-10 border text-base! ring-transparent! outline-transparent!"
              pattern="^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$"
              onFocus={(e) => e.target.select()}
            />
            <CopyButton text={field.value} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

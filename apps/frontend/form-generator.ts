/* eslint-disable @typescript-eslint/no-explicit-any */
import { agentProfile } from "@/features/settings/schemas";
import * as fs from "fs";

function getImportPath(componentName: string): string {
  const map: Record<string, string> = {
    Input: "@/components/ui/input",
    Checkbox: "@/components/ui/checkbox",
    Select: "@/components/ui/select",
    SelectContent: "@/components/ui/select",
    SelectItem: "@/components/ui/select",
    SelectTrigger: "@/components/ui/select",
    SelectValue: "@/components/ui/select",
  };
  return map[componentName] || "@/components/ui/input";
}

type TypeInfo = {
  name: string;
  isNullable: boolean;
  isArray: boolean;
  entries: string[];
};

function getTypeInfo(zodType: any) {
  let fieldType = zodType.type;
  let isNullable = fieldType === "nullable";
  let isArray = false;
  const entries: string[] = [];
  let def = zodType.def;

  while (def && def.type) {
    const defType = def.type;
    if (defType === "nullable") {
      isNullable = true;
    }
    fieldType = defType;
    if (defType === "array") {
      fieldType = def.element.type;
      isArray = true;
    }
    if (defType === "enum") {
      for (const e of Object.values(def.entries)) {
        entries.push(e as string);
      }
    }

    const defInnerType = def.innerType;
    if (defInnerType) {
      def = defInnerType.def;
    } else {
      break;
    }
  }
  return {
    name: fieldType,
    isNullable,
    isArray,
    entries,
  } as TypeInfo;
}

function getFormElementForZodType(
  fieldName: string,
  typeInfo: TypeInfo,
): { component: string; imports: string[] } {
  switch (typeInfo.name) {
    case "string":
      const stringProps = typeInfo.isNullable
        ? `value={field.value ?? ""} 
           onChange={(e) => field.onChange(e.target.value || null)}`
        : "";
      return {
        component: `<Input 
                      placeholder="Enter ${fieldName}"
                      {...field} 
                      ${stringProps}
                      id="form-${schemaName}-${fieldName}"
                      aria-invalid={fieldState.invalid}
                    />`,
        imports: ["Input"],
      };
    case "number":
      return {
        component: `<Input 
                      type='number'
                      placeholder="Enter ${fieldName}" 
                      {...field} 
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(
                          isFinite(e.target.valueAsNumber)
                            ? e.target.valueAsNumber
                            : "",
                         )
                      }
                      id="form-${schemaName}-${fieldName}"
                      aria-invalid={fieldState.invalid}
                    />`,
        imports: ["Input"],
      };
    case "boolean":
      return {
        component: `<Checkbox                       
                      {...field} 
                      id="form-${schemaName}-${fieldName}"
                      aria-invalid={fieldState.invalid}
                    />`,
        imports: ["Checkbox"],
      };
    case "enum":
      const selectItems = typeInfo.entries
        .map((opt) => `<SelectItem value="${opt}">${opt}</SelectItem>`)
        .join("\n                  ");

      return {
        component: `<Select                       
                        {...field} 
                        aria-invalid={fieldState.invalid}>
                  <SelectTrigger id="form-${schemaName}-${fieldName}">
                    <SelectValue placeholder="Select ${fieldName}" />
                  </SelectTrigger>
                <SelectContent>
                  ${selectItems}
                </SelectContent>
              </Select>`,

        imports: [
          "Select",
          "SelectContent",
          "SelectItem",
          "SelectTrigger",
          "SelectValue",
        ],
      };
    default:
      return {
        component: ``,
        imports: [],
      };
  }
}

function generateFormCode(
  schemaName: string,
  schema: any,
  componentName: string,
): string {
  const shape = schema.def.shape;
  const fields = Object.keys(shape);
  const usedComponents = new Set<string>();

  const typeInfos = Object.fromEntries(
    fields.map((fieldName) => [fieldName, getTypeInfo(shape[fieldName])]),
  );

  const arrayFieldSnippets = Object.entries(typeInfos)
    .filter(([_, typeInfo]) => typeInfo.isArray)
    .map(
      ([
        fieldName,
        _,
      ]) => `  const { fields: ${fieldName}Fields, append: ${fieldName}Append, remove:${fieldName}Remove } = useFieldArray({
    control:form.control,
    name: "${fieldName}" 
  });`,
    );

  const fieldSnippets = Object.entries(typeInfos).map(
    ([fieldName, typeInfo]) => {
      if (typeInfo.isArray) {
        const { component, imports } = getFormElementForZodType(
          `${fieldName}.\${index}`,
          typeInfo,
        );
        imports.forEach((imp) => usedComponents.add(imp));
        const label = fieldName
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, (str) => str.toUpperCase());
        return `
        <FieldSet>
          <FieldLabel>
          ${label}
          </FieldLabel>
        {${fieldName}Fields.map((item, index) => (
                  <Controller
                    key={item.id}
                    name={\`${fieldName}.\${index}\`} 
                    control={form.control}
                    render={({ field, fieldState}) => (
                      <div className="flex items-center justify-between">
                        ${component}
                        <button type="button" onClick={() => ${fieldName}Remove(index)}>Remove</button>
                      </div>
                    )}
                  />
            ))}
            <button type="button" onClick={() => ${fieldName}Append({})}>Add</button>
          </FieldSet>
          `;
      }

      const { component, imports } = getFormElementForZodType(
        fieldName,
        typeInfo,
      );
      // Track which Shadcn components we actually need to import
      imports.forEach((imp) => usedComponents.add(imp));

      // Convert camelCase to Title Case for labels
      const label = fieldName
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (str) => str.toUpperCase());

      return `
        <Controller
          control={form.control}
          name="${fieldName}"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="form-${schemaName}-${fieldName}">
                ${label}
             </FieldLabel>
              ${component}
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />`;
    },
  );

  // Group our dynamic imports by their file path
  const importGroups = Array.from(usedComponents).reduce(
    (acc, comp) => {
      const path = getImportPath(comp);
      if (!acc[path]) acc[path] = [];
      acc[path].push(comp);
      return acc;
    },
    {} as Record<string, string[]>,
  );

  const dynamicImportStatements = Object.entries(importGroups)
    .map(
      ([path, comps]) =>
        `import { ${comps.sort().join(", ")} } from "${path}";`,
    )
    .join("\n");

  console.log("Dynamic Imports:\n", dynamicImportStatements);

  return `
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm,useFieldArray } from "react-hook-form"
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet
} from "@/components/ui/field"

${dynamicImportStatements}

type ${componentName}Values = z.infer<typeof ${schemaName}>;

export function ${componentName}() {
  const form = useForm<${componentName}Values>({
    resolver: zodResolver(${schemaName}),
    defaultValues: {
      // TODO: Set initial default values
    },
  });

  ${arrayFieldSnippets.join("\n  ")}

  function onSubmit(data: ${componentName}Values) {
    console.log(data);
  }

  return (
      <form id='${schemaName}-form' onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FieldGroup>
          ${fieldSnippets.join("\n")}
          <Button type="submit">Submit</Button>
        </FieldGroup>
      </form>
  );
}
`.trim();
}

const schemaName = "agentProfile";
const componentName = `${schemaName[0].toUpperCase() + schemaName.slice(1)}Form`;
const outputFileName = `${componentName}.tsx`;

const generatedCode = generateFormCode(schemaName, agentProfile, componentName);

fs.writeFileSync(outputFileName, generatedCode);
console.log(`✅ Successfully generated ${outputFileName}`);

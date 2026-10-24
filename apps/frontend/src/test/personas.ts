import type { PersonaCollection, PersonaProvenance } from "@/lib/client";

export const defaultPersonaProvenance: PersonaProvenance = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Default",
  revision: 1,
};

export const defaultPersonas: PersonaCollection = {
  default_persona_id: defaultPersonaProvenance.id,
  default_revision: 1,
  profiles: [
    {
      ...defaultPersonaProvenance,
      user_md: "",
      created_at: 0,
      updated_at: 0,
      is_default: true,
    },
  ],
};

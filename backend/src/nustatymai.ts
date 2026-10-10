/**
 * Šeimos nustatymai iš Worker'io kintamųjų (wrangler.toml [vars]): šeimos pavadinimas ir
 * įjungti neprivalomi moduliai. Darbai, kalendorius, pirkiniai, ruoša, projektai ir
 * pranešimai veikia visada.
 */

export type Modulis = "finansai" | "asistentas" | "claude" | "google";

export const MODULIAI: Modulis[] = ["finansai", "asistentas", "claude", "google"];

export interface Nustatymai {
  seima: string;
  moduliai: Modulis[];
}

export interface NustatymuEnv {
  SEIMA?: string;
  MODULIAI?: string;
}

/** Neužpildytas (<<…>>) ar nenurodytas — įjungta viskas (patogu kuriant ir testuojant). */
export function nustatymai(env: NustatymuEnv): Nustatymai {
  const raw = env.MODULIAI && !env.MODULIAI.includes("<<") ? env.MODULIAI : MODULIAI.join(",");
  const moduliai = raw
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter((m): m is Modulis => (MODULIAI as string[]).includes(m));
  const seima = env.SEIMA && !env.SEIMA.includes("<<") ? env.SEIMA : "Mūsų šeima";
  return { seima, moduliai };
}

export const ijungta = (env: NustatymuEnv, modulis: Modulis) => nustatymai(env).moduliai.includes(modulis);

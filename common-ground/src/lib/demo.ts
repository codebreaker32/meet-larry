import { SEAT_COLORS } from "./tokens";
import type { Profile } from "./types";

// Synthetic example people (Sam and Priya, the home page's example play mat and the tests) and the
// Pick a pal practice characters. The picks are real Qloo entities; the people are made up and
// labelled wherever they appear. Sam and Priya share no favourite on purpose: they show common
// ground between two people with nothing obviously in common.

const img = (id: string) => `https://images.qloo.com/i/${id}-420x-auto.jpg`;

export const DEMO_SAM: Profile = {
  name: "Sam",
  items: [
    { id: "9B33A620-68CA-49B3-BFCF-F09CCF8AD595", name: "Spirited Away", domain: "movie", image: img("9B33A620-68CA-49B3-BFCF-F09CCF8AD595") },
    { id: "CDBDE254-71F0-4640-8D04-5373BEAE5278", name: "Minecraft", domain: "videogame", image: img("CDBDE254-71F0-4640-8D04-5373BEAE5278") },
    { id: "1CDF9B1C-152D-4107-A504-BCBB939CAB54", name: "The Lightning Thief", domain: "book", image: img("1CDF9B1C-152D-4107-A504-BCBB939CAB54") },
    { id: "088692C7-5BF8-4663-BC58-60D03A1A2A5A", name: "Avatar: The Last Airbender", domain: "tv_show", image: img("088692C7-5BF8-4663-BC58-60D03A1A2A5A") },
  ],
};

export const DEMO_PRIYA: Profile = {
  name: "Priya",
  items: [
    { id: "17CA60C4-D34B-4D9C-B6BC-E1CD59BDFAA5", name: "Fleet Foxes", domain: "artist", image: img("17CA60C4-D34B-4D9C-B6BC-E1CD59BDFAA5") },
    { id: "5E80DB9D-FF98-4E7D-BD59-E04C0A17457D", name: "Heartstopper", domain: "tv_show", image: img("5E80DB9D-FF98-4E7D-BD59-E04C0A17457D") },
    { id: "969911E8-7092-43D9-8C7D-C7547EAE3C00", name: "Little Women", domain: "movie", image: img("969911E8-7092-43D9-8C7D-C7547EAE3C00") },
    { id: "AFBC71A7-9439-4AB0-AB68-D14B11AAF836", name: "Phoebe Bridgers", domain: "artist", image: img("AFBC71A7-9439-4AB0-AB68-D14B11AAF836") },
  ],
};

/**
 * The two seats of a Pick a pal chat (you and the pal): the first two of the one seat list (SEAT_COLORS in @/lib/tokens).
 * A practice character takes seat b with its own seat colour, which must never be seat a's, or the
 * two people's dots and markers look the same.
 */
export const PAIR_SEATS = [SEAT_COLORS[0], SEAT_COLORS[1]] as const;

export type PracticeLevel = "Easy" | "Medium" | "Shy";

export interface Persona {
  id: string;
  profile: Profile;
  vibe: string;
  /** How much of the conversation the character carries, like a practice difficulty. */
  level: PracticeLevel;
  levelNote: string;
  /** Seat b's colour in practice. A seat token from @/lib/tokens, never PAIR_SEATS[0] (see seatColors). */
  color: string;
}

const p = (id: string, name: string, domain: Profile["items"][number]["domain"]) => ({ id, name, domain, image: img(id) });

// Made-up practice partners with fixed tastes (real Qloo picks). Never real people.
export const PERSONAS: Persona[] = [
  {
    id: "maya",
    profile: {
      name: "Maya",
      items: [
        p("68CD7C41-78BE-4765-B184-1F1988036C89", "Your Name.", "movie"),
        p("9328463A-D757-43FE-A7DA-FB2DB77F0B43", "Jujutsu Kaisen", "tv_show"),
        p("C5FBF982-EA78-42C7-A6F7-BEC4835EF5F4", "Persona 5", "videogame"),
        p("4E5B2798-C063-4CC9-8746-F913DB1973BA", "Joji", "artist"),
      ],
    },
    vibe: "Anime, JRPGs and late-night music",
    level: "Easy",
    levelNote: "Chatty. Asks you lots of questions.",
    color: "var(--seat-2)",
  },
  {
    id: "leo",
    profile: {
      name: "Leo",
      items: [
        p("2108A362-6EF1-4A64-8404-FDEB9FFA517F", "EA Sports FC 24", "videogame"),
        p("FAA55DC8-6030-4CC8-9BA6-4668295C3FA7", "Drake", "artist"),
        p("DCA1F3CA-7A25-421C-BB4D-A864B6D53848", "Ted Lasso", "tv_show"),
        p("E4BF0EDE-0E1A-4FDD-A209-464004BC6659", "Moneyball", "movie"),
      ],
    },
    vibe: "Football, hip-hop and underdog stories",
    level: "Medium",
    levelNote: "Friendly, but you lead half the time.",
    color: "var(--seat-5)",
  },
  {
    id: "aisha",
    profile: {
      name: "Aisha",
      items: [
        p("C471E196-F06E-4C78-B723-6DBAE7A003B3", "The Seven Husbands of Evelyn Hugo", "book"),
        p("A37B17AE-15C7-48A3-AADD-6CE50BE3FF74", "Lorde", "artist"),
        p("19DF9974-2931-42F7-AF6F-DC29B9E17974", "Normal People", "tv_show"),
        p("4BE414CF-375F-4566-AA66-9AC6150A6B7F", "Lady Bird", "movie"),
      ],
    },
    vibe: "Big feelings, books and indie films",
    level: "Medium",
    levelNote: "Thoughtful. Likes a real question.",
    color: "var(--seat-4)",
  },
  {
    id: "kenji",
    profile: {
      name: "Kenji",
      items: [
        p("F4370AF5-3171-48C7-95DB-38ED25B1F80C", "Hollow Knight", "videogame"),
        p("3037F0E8-C912-4DC0-BDE3-1F94631F9DA6", "Dune", "movie"),
        p("012EF80C-B187-4ECB-9C3D-9CA5228B503C", "Daft Punk", "artist"),
        p("C6D1A3A8-1694-4AB3-B257-E8836AEE6197", "Arcane", "tv_show"),
      ],
    },
    vibe: "Hard games, sci-fi and electronic music",
    level: "Shy",
    levelNote: "Short answers. Good practice for keeping a chat going.",
    color: "var(--seat-3)",
  },
];

/** The two seat colours for a session: a practice character's own colour, unless it would match seat a. */
export function seatColors(persona?: Pick<Persona, "color">): { a: string; b: string } {
  const [a, fallback] = PAIR_SEATS;
  const b = persona?.color && persona.color !== a ? persona.color : fallback;
  return { a, b };
}

export const findPersona = (id: string | null | undefined) => PERSONAS.find((x) => x.id === id);

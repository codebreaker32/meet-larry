import {
  BookOpen,
  CircleDot,
  Clapperboard,
  Diamond,
  Gamepad2,
  Gauge,
  Goal,
  LayoutGrid,
  Medal,
  Mic,
  Music2,
  Plane,
  ShoppingBag,
  Trophy,
  Tv,
  UserRound,
  Volleyball,
  type LucideIcon,
} from "lucide-react";
import type { Sport } from "./starters";
import type { Domain } from "./types";

// Category = colour + icon, always. Frame colours are the --cat-* tokens in globals.css (:root and
// @theme). Ink text on every one is at least 6:1, except Games violet (4.4:1), which uses
// --cat-games-tint behind titles instead. Colour never works alone: film and sports, music and
// brands, brands and people look alike to colour-blind people, so each category has its own icon
// (unique, checked in domain-style.test.ts) and every consumer shows the icon or the label.
export const DOMAIN_STYLE: Record<Domain, { label: string; color: string; Icon: LucideIcon }> = {
  movie: { label: "Film", color: "var(--cat-film)", Icon: Clapperboard },
  tv_show: { label: "TV", color: "var(--cat-tv)", Icon: Tv },
  artist: { label: "Music", color: "var(--cat-music)", Icon: Music2 },
  videogame: { label: "Games", color: "var(--cat-games)", Icon: Gamepad2 },
  book: { label: "Books", color: "var(--cat-books)", Icon: BookOpen },
  sports_team: { label: "Sports", color: "var(--cat-sports)", Icon: Trophy },
  athlete: { label: "Players", color: "var(--cat-players)", Icon: Medal },
  podcast: { label: "Podcasts", color: "var(--cat-podcasts)", Icon: Mic },
  brand: { label: "Brands", color: "var(--cat-brands)", Icon: ShoppingBag },
  destination: { label: "Travel", color: "var(--cat-travel)", Icon: Plane },
  person: { label: "People", color: "var(--cat-people)", Icon: UserRound },
};

/**
 * The sport filter inside Sports and Players. Qloo has no pictures of the sports themselves, so
 * these are local Lucide icons; the teams and players in the grid are Qloo photos.
 */
export const SPORT_FILTERS: { key: Sport | "all"; label: string; Icon: LucideIcon }[] = [
  { key: "all", label: "All", Icon: LayoutGrid },
  { key: "cricket", label: "Cricket", Icon: CircleDot },
  { key: "football", label: "Football", Icon: Goal },
  { key: "basketball", label: "Basketball", Icon: Volleyball },
  { key: "baseball", label: "Baseball", Icon: Diamond },
  { key: "f1", label: "F1", Icon: Gauge },
];

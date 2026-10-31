import type { Domain, TasteItem } from "./types";

// Picture-first starting grid: real Qloo entities (ids and art from /api/search, 2026-10-29;
// sports, players, podcasts, brands, travel and people from Qloo /search, 2026-10-30; Coco and FC Goa
// added from /api/search on 2026-10-30 after the persona walkthroughs), broadly
// popular with 19-year-olds, including many from India and outside the US and UK.
// Hard-coded so the first screen shows pictures straight away, with no network wait.
// Qloo has no pictures for destinations, so travel tiles show the place name on its colour.

const img = (id: string) => `https://images.qloo.com/i/${id}-420x-auto.jpg`;

function item(domain: Domain, id: string, name: string, image = true): TasteItem {
  return image ? { id, name, domain, image: img(id) } : { id, name, domain };
}

/** Sports a team or player belongs to, for the sport filter in the picker. Icons live in domain-style.ts. */
export type Sport = "cricket" | "football" | "basketball" | "baseball" | "f1" | "other";

export const SPORT_OF: Record<string, Sport> = {};

function sport(s: Sport, domain: "sports_team" | "athlete", id: string, name: string): TasteItem {
  SPORT_OF[id] = s;
  return item(domain, id, name);
}

export const STARTERS: Record<Domain, TasteItem[]> = {
  movie: [
    item("movie", "9B33A620-68CA-49B3-BFCF-F09CCF8AD595", "Spirited Away"),
    item("movie", "F45B618F-0638-427D-AC5A-5FA04F7F75C9", "Spider-Man: Across the Spider-Verse"),
    item("movie", "057DA9D9-399B-437E-8BCA-A80E499125EF", "Interstellar"),
    item("movie", "BAF6FB9E-7E2E-4008-944B-97C0CF430D41", "Barbie"),
    item("movie", "68CD7C41-78BE-4765-B184-1F1988036C89", "Your Name."),
    item("movie", "CE300FA0-0752-4DD3-B28F-FC4CFD2D8915", "3 Idiots"),
    // Persona walkthrough (Rohan): Coco is a well-loved favourite that had to be spelled out in search.
    item("movie", "649672AD-38A4-42C7-BAAC-BBD2D5BEEFA0", "Coco"),
    item("movie", "F0D354AA-BA7E-49D2-8ABA-9A8250F5C852", "Everything Everywhere All at Once"),
    item("movie", "878A5D45-469C-4556-8494-963C2B1D3A95", "Dune: Part Two"),
  ],
  tv_show: [
    item("tv_show", "07F1170E-BB69-4982-82C6-255F477EBBAD", "Stranger Things"),
    item("tv_show", "C7842364-C850-4013-BC84-330732687872", "One Piece"),
    item("tv_show", "C6D1A3A8-1694-4AB3-B257-E8836AEE6197", "Arcane"),
    item("tv_show", "340C4A42-8726-42C9-BFA6-FBA6F923E5E6", "Squid Game"),
    item("tv_show", "A0C54500-13CF-4193-A42E-FF0B72C42F88", "Wednesday"),
    item("tv_show", "5E80DB9D-FF98-4E7D-BD59-E04C0A17457D", "Heartstopper"),
    item("tv_show", "7CC277BA-B432-4259-8790-01D0645FC673", "Attack on Titan"),
    item("tv_show", "088692C7-5BF8-4663-BC58-60D03A1A2A5A", "Avatar: The Last Airbender"),
  ],
  artist: [
    item("artist", "4BBEF799-A0C4-4110-AB01-39216993C312", "Taylor Swift"),
    item("artist", "924C8504-4BD8-4615-AB2D-1C16880A8A62", "Arijit Singh"),
    item("artist", "F347D506-CB6F-46FA-9A8B-AFBC31C71A1A", "BTS"),
    item("artist", "D7BCE4CD-5135-4608-8A7D-78E08FFD52F3", "Billie Eilish"),
    item("artist", "BDA1B73F-10E7-4D09-AC51-B796CCEC5FF3", "Bad Bunny"),
    item("artist", "087EF30C-3367-49B8-AC58-8B8C01D69DB6", "Olivia Rodrigo"),
    item("artist", "A9C3CE3F-9A0C-47B3-8AF8-E75B252F86D8", "The Weeknd"),
    item("artist", "E2E58680-EE3F-4D1D-88B6-B79F87205B2C", "SZA"),
  ],
  videogame: [
    item("videogame", "CDBDE254-71F0-4640-8D04-5373BEAE5278", "Minecraft"),
    item("videogame", "875DB771-9C4C-4DD0-9249-D2ABD95711F1", "Stardew Valley"),
    item("videogame", "7E606158-8878-49D6-82AB-4C83A83F9974", "The Legend of Zelda: Breath of the Wild"),
    item("videogame", "B335BB51-7158-4C34-89D1-4F1DB7CB5C01", "Fortnite"),
    item("videogame", "DE584C3E-25B7-4B25-9BD8-30A12D4B686F", "Genshin Impact"),
    item("videogame", "08663BD2-E267-4C7F-9895-86410F67867C", "Animal Crossing: New Horizons"),
    item("videogame", "43B2316E-1192-42BF-AAF7-78E06BADD771", "Mario Kart 8 Deluxe"),
    item("videogame", "F4370AF5-3171-48C7-95DB-38ED25B1F80C", "Hollow Knight"),
  ],
  book: [
    item("book", "F152B168-D93D-4444-A1AD-2B8653E223B0", "Harry Potter and the Sorcerer's Stone"),
    item("book", "1CDF9B1C-152D-4107-A504-BCBB939CAB54", "The Lightning Thief"),
    item("book", "D61A0673-FE55-4C63-BC37-79764521F13C", "Heartstopper"),
    item("book", "38F93999-82C4-4892-B64F-8F98EB0699A9", "The Hunger Games"),
    item("book", "FA07222D-7A5D-45BA-925E-A868795D1EB9", "The Song of Achilles"),
    item("book", "B825EF97-D564-48B8-8775-6FD4BD1166BD", "Six of Crows"),
    item("book", "63BC9A33-FF92-43B8-BBEB-25277BD7D852", "The Fault in Our Stars"),
    item("book", "6967F12E-7810-4A1B-8C4B-7BDBB2969633", "A Court of Thorns and Roses"),
  ],
  sports_team: [
    sport("cricket", "sports_team", "11E8F514-0D1A-45F8-B180-06068C4F7D29", "Mumbai Indians"),
    sport("cricket", "sports_team", "49E0A5AB-4868-4E61-9AFD-0AA612596555", "Chennai Super Kings"),
    sport("cricket", "sports_team", "899873ED-A19C-4C15-B52F-E09A05EDE977", "Royal Challengers Bangalore"),
    sport("cricket", "sports_team", "D1DD944F-AC36-4D68-85D9-E8707BCAB490", "India Men's National Cricket Team"),
    sport("football", "sports_team", "3AE1EAA9-1A61-4AEC-BBC5-47C5B8ABC720", "Real Madrid CF"),
    sport("football", "sports_team", "AB274E13-8E14-4A39-BCB6-82977B9DB380", "FC Barcelona"),
    sport("football", "sports_team", "D719B77A-E9A2-4E07-BF7B-F6ED1C9521C6", "Manchester United F.C."),
    // Persona walkthrough (Diego): an Indian football club, so football fans in India see a home team.
    sport("football", "sports_team", "36606E2A-F1D7-48FA-9A04-9E9549A33752", "FC Goa"),
    sport("football", "sports_team", "AD4951B4-2543-4CBA-9BED-214FFB7CDA7F", "FC Barcelona Femení"),
    sport("basketball", "sports_team", "9EA0A171-B6E8-49BE-A216-739460F6FC91", "Los Angeles Lakers"),
    sport("basketball", "sports_team", "F8B5FC50-B377-41F9-9A5F-A422F391EDA3", "Golden State Warriors"),
    sport("baseball", "sports_team", "709D89A7-455A-40E4-A0D3-E77201C1C630", "New York Yankees"),
    sport("baseball", "sports_team", "9B8B279C-B777-4293-8121-B8174970B57D", "Los Angeles Dodgers"),
    sport("f1", "sports_team", "7F342526-5A01-4AFD-B53F-981A88F196B2", "Scuderia Ferrari"),
    sport("f1", "sports_team", "776152C5-ED96-4A52-98A7-A393D4EDA478", "Red Bull Racing"),
    sport("f1", "sports_team", "A0898BB0-0545-49D5-9835-489885F01374", "Mercedes AMG Petronas F1 Team"),
    sport("f1", "sports_team", "40BC6A46-4A48-4235-B416-10DFAB53A904", "McLaren Racing"),
  ],
  athlete: [
    sport("cricket", "athlete", "67764010-965B-4787-A53B-0B8F60EDD5ED", "Virat Kohli"),
    sport("cricket", "athlete", "AA897FAA-12FE-4C61-BE5D-345485F6C9F3", "Harmanpreet Kaur"),
    sport("cricket", "athlete", "5DF06D93-8AD1-47E5-B689-561775263898", "MS Dhoni"),
    sport("cricket", "athlete", "6A948CB2-50C3-46F7-91C1-E6D03EFBEE24", "Smriti Mandhana"),
    sport("football", "athlete", "E1E729E0-E8A8-4A23-93C5-3BEECC539120", "Lionel Messi"),
    sport("football", "athlete", "B0AD05A3-D334-4A0B-90A7-4F285256AFA8", "Cristiano Ronaldo"),
    sport("football", "athlete", "D7C4EFB8-75A5-4415-BF3C-6B1C9B3DF8D0", "Alexia Putellas"),
    sport("football", "athlete", "D7BB82D0-1E0B-4A42-BB87-0F7FBF756667", "Sunil Chhetri"),
    sport("basketball", "athlete", "B53135E5-819E-4890-8396-59373C0A949F", "LeBron James"),
    sport("basketball", "athlete", "FEB63CEE-D890-4648-B54A-F45E176EA6D8", "Stephen Curry"),
    sport("basketball", "athlete", "7D9DEB2D-3CCF-49CD-A8EC-6818E9F0936B", "Caitlin Clark"),
    sport("baseball", "athlete", "4E12DB40-76F8-4E48-8F89-07F8FC9B490B", "Shohei Ohtani"),
    sport("f1", "athlete", "FD681F02-1EA5-4E8F-B036-3C93D80B81E7", "Lewis Hamilton"),
    sport("f1", "athlete", "9AFE6FB6-C365-4D63-87E4-66AA3C33B166", "Max Verstappen"),
    sport("other", "athlete", "2D457621-AED4-482A-94F1-FAF883B5EF47", "Neeraj Chopra"),
  ],
  podcast: [
    item("podcast", "5BA7FD6C-174D-4879-94AB-13BA0557A38F", "On Purpose with Jay Shetty"),
    item("podcast", "EF39C34A-4A37-476A-8DAA-EB8A376F10DD", "Khandaan - A Bollywood Podcast"),
    item("podcast", "86BC43F3-A5EA-4EB2-942B-999F5AE69B4F", "Stuff You Should Know"),
    item("podcast", "A543F312-1893-4330-8125-7441966EF9EE", "Crime Junkie"),
    item("podcast", "761AABED-6DD4-4648-9F1D-04FE1C383AA4", "Anything Goes with Emma Chamberlain"),
    item("podcast", "28088510-F5BE-4254-9A3D-908E3F114BBB", "The Diary Of A CEO"),
    item("podcast", "10E08FC9-04BB-4827-9331-7E9ABE1F7DB6", "Huberman Lab"),
    item("podcast", "D95B20A8-0CEA-4BDC-8074-60A303FA1980", "Song Exploder"),
    item("podcast", "B297424F-2B80-4D7F-B428-55C0885E8268", "TED Talks Daily"),
  ],
  brand: [
    item("brand", "C70CE2B8-0AD1-4150-BF18-5A6347F2E860", "Nike"),
    item("brand", "FCEA7CA1-1D40-4680-B337-E74594D9BCF1", "Adidas"),
    item("brand", "BA8BEA86-40F0-404B-8AAA-27385BFA20A0", "boAt"),
    item("brand", "8F6ED0EA-EEFC-4865-9CED-0C30BB40020A", "Nykaa"),
    item("brand", "CA1C34DD-CAB7-4E3F-8A68-D0415BAF87A2", "Royal Enfield"),
    item("brand", "C5E85462-1B81-40FF-A7B4-849DEE5120E9", "LEGO"),
    item("brand", "D5B78065-6DBB-4DDB-80DF-6495B9B1006B", "Apple"),
    item("brand", "46C9F889-EC89-4715-A767-DEABACF52C41", "Uniqlo"),
    item("brand", "99CBD9B1-F023-4034-97E7-E95A4A85BDD2", "Spotify"),
    item("brand", "7E9A2E74-1CB5-43E9-8B74-69CA8283BFBD", "IKEA"),
    item("brand", "2C5054E1-8691-4F52-83CD-310D029BA6A3", "Sephora"),
    item("brand", "B13C02E3-BA3C-4B39-85B4-ACF12FEBC892", "Starbucks"),
  ],
  destination: [
    item("destination", "1EB0550F-0F82-43A2-B501-4D33B5488FD1", "Tokyo", false),
    item("destination", "B23C8909-F53C-48A5-AA44-9B664532806E", "Goa", false),
    item("destination", "E1BC6CD3-53D0-404E-8274-07B95334CB53", "Jaipur", false),
    item("destination", "CA0AE5AD-1FF6-41A0-8B95-4750E7542E7C", "Manali", false),
    item("destination", "C83631DD-8083-4428-BB90-3A092535DCEE", "Rishikesh", false),
    item("destination", "AA6F2D58-008A-4FC8-B374-C103D4D86B16", "Seoul", false),
    item("destination", "95E19B2C-553A-46A6-AD73-5562AF7124E5", "Kyoto", false),
    item("destination", "70E3820A-B1CF-4676-9CDA-C5F6539C53B9", "Paris", false),
    item("destination", "29D176AB-418C-4A6D-B4DA-18E1A9D5FC72", "London", false),
    item("destination", "99FB5527-DACF-42DF-816B-36B5D004F639", "New York City", false),
    item("destination", "B89A3ED8-C053-46E0-AB43-A34AAD6DFEE0", "Bali", false),
    item("destination", "426B5872-421C-4831-BEDD-89BCCD5474B2", "Barcelona", false),
  ],
  person: [
    item("person", "6F78A2FF-DFB3-4A01-AC9B-900FF3D019B7", "Shah Rukh Khan"),
    item("person", "87D110E5-8C9F-4A14-97F9-7F15DB2C730C", "Deepika Padukone"),
    item("person", "419C9A74-443F-4C32-A736-E15CF0FAC291", "Priyanka Chopra"),
    item("person", "AB095B6A-EE19-463D-ACC9-A0A42D2547A0", "Bhuvan Bam"),
    item("person", "8ED28227-8E40-4DD0-B76A-082BB5D2D4D9", "Zendaya"),
    item("person", "5235243B-6428-40A2-836F-7ADA4DBA5FC6", "Pedro Pascal"),
    item("person", "A57D8846-AC6A-471A-BF14-61A7DB7CEBD5", "Keanu Reeves"),
    item("person", "2AFEE78A-A5B8-40E7-88C1-273D05EE7019", "Hayao Miyazaki"),
    item("person", "658F8F46-439F-484F-AE9C-4814CDB6B7E4", "MrBeast"),
  ],
};

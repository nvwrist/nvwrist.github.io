# ASCII World — events & quests (data-driven scripting)

Events are plain JSON, so quests change **without rebuilding the game**:

- default events live in `ascii/events.json` (fetched at start, no cache) — edit that file and push;
- in the game: editor → «📜 События» shows the JSON, has templates, validation and help; «✓ применить» stores them in the map (`MAP.events`, localStorage). «⟲ из events.json» drops the map copy and returns to the file;
- the map export (`⤓ экспорт`) includes events, so a map + its quests travel as one file.

Later (MMO) the same JSON is meant to be evaluated by the server: the client only sends triggers (`talk`, `enter`, …) and plays back actions (`say`, `give`, …).

## Shape

```json
{ "id": "unique", "on": "talk", "npc": "Mira",
  "if": [ { "quest": "apples", "is": "active" }, { "has": "apple", "n": 3 } ],
  "once": false,
  "do": [ { "take": "apple", "n": 3 }, { "give": "coin", "n": 15 }, { "quest": "apples", "set": "done" } ] }
```

All matching events for a trigger run; conditions are checked **before** any action runs, so write mutually exclusive `if`s for the stages of a quest (see Mira in `events.json`).

## Triggers (`on`)
| on | filter field | fired when |
|---|---|---|
| `start` | — | game loaded (use `"once": true`) |
| `talk` | `npc` (Mira, Kael, Oru) | player presses 💬 / E next to an NPC. If nothing matches, the NPC says a random line |
| `enter` / `leave` | `area` = tag of a 🎯 zone prop | player walks in / out of the zone circle |
| `pickup` / `use` | `item` | item picked up / used from the bag |
| `kill` | `mob` (`shade`) | monster killed in the dungeon |
| `interval` | `every` (seconds) | timer while in the forest |

## Conditions (`if`, array = AND)
`{"quest":"id","is":"none|active|done"}` (or array of states) · `{"has":"apple","n":3}` · `{"flag":"x"}` · `{"flag":"x","is":false}` · `{"flag":"n","gte":2}` · `{"not":{…}}` · `{"any":[…]}` · `{"hp":3}` · `{"zone":"forest"}` · `{"chance":0.3}`

## Actions (`do`, run in order, async)
`say` (+`who`) · `ask` (+`who`, `options: [{text, do}]`) · `quest` (+`set`, `title`, `note`) · `give` / `take` (+`n`) · `flag` (+`set` | `add`) · `hp` (delta) · `toast` · `log` (+`who`, `color`) · `weather` (0–4) · `spawn` (+`x`,`z`,`n`) · `teleport` `[x,z]` · `wait` (sec) · `show` / `hide` (prop tag) · `fx` (`arcane|fire|nature`) · `run` (event id)

State (`flags`, `quests`, `done`) is saved with the game (`localStorage['ascii-save-v1'].ev`). Adding a new trigger/action: `emitEvent(type, data)` at the source + a branch in `doAction` / `cond` in `game.js`, then document it here and in the in-game help (`#evEd details` in index.html).

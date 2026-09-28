// SFO Flight: a Harbor Engine title. The engine draws the bay; this title is its map.json, its baked data in public/,
// the flight model in fdm/ and the "flight" game (src/game/flight.js) registered before boot.
import 'harbor-engine/src/ui/ui.css';
import './game/game.css';
import './game/flight.js';
import map from '../map.json';
import { boot } from 'harbor-engine';

boot( { map } );

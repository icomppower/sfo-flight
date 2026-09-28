// UI strings, English and 中文 (Traditional). The game reads T(lang).
const EN = {
  title: 'SFO Flight', tagline: 'Fly a Cessna 172 or a Boeing 777 from SFO over the real bay.',
  aircraft: 'Aircraft', c172: 'Cessna 172 (light single)', b77w: 'Boeing 777-300ER (heavy twin)',
  start: 'Start', startAt: 'Start position', ramp: 'Parked at the ramp', rampCold: 'Ramp, cold and dark', runway: 'On the runway', final9: '9 NM final', final3: '3 NM final', ggb: 'Over the Golden Gate',
  weather: 'Weather', metar: 'METAR', custom: 'Custom', wind: 'Wind', vis: 'Visibility', time: 'Time', lang: 'Language', fly: 'Fly', resume: 'Resume', menu: 'Menu', replay: 'Replay', again: 'Fly again', controls: 'Controls', remap: 'Gamepad / keys',
  dawn: 'Dawn', day: 'Midday', golden: 'Golden hour', night: 'Night',
  landed: 'Landed', crashed: 'Crashed', score: 'Landing score', sink: 'Touchdown rate', centre: 'Centreline', tdz: 'Touchdown zone', bounces: 'Bounces', stop: 'Stopped', grade: 'Grade',
  crash: { terrain: 'Flew into terrain', water: 'Hit the water', building: 'Hit a building', 'hard-landing': 'Landing too hard', overstress: 'Structural overstress', 'gear-up': 'Gear-up landing', nacelle: 'Engine pod strike', wingtip: 'Wing strike', nose: 'Nose strike', prop: 'Propeller strike' },
  cams: { cockpit: 'Cockpit', chase: 'Chase', tower: 'Tower', free: 'Free' },
  shots: { establish: 'Wide', chase: 'Chase', wing: 'Wing', cockpit: 'Flight deck', tower: 'Tower cab', spotter: 'Spotter', rollout: 'Rollout', side: 'Runway side' },
  replaying: 'Replay', stall: 'STALL', pull: 'PULL UP', tail: 'TAIL STRIKE', parked: 'PARKING BRAKE', ap: 'AUTOPILOT', apOff: 'AP DISCONNECT',
  help: 'Arrows / W S A D pitch and roll · Q E rudder · PgUp PgDn throttle · F flaps (Shift+F up) · G gear · B brakes (Shift+B park) · / spoilers · Home End trim · Shift+A autopilot · C camera · Y mouse yoke · Esc menu',
  helpShort: 'Esc menu · C camera · H hide HUD',
  mcp: { AP: 'A/P', AT: 'A/T', HDG: 'HDG', ALT: 'ALT', VS: 'V/S', SPD: 'SPD', LOC: 'LOC', APP: 'APP', AB: 'A/BRK' },
  engine: 'Engine', master: 'Master', mags: 'Magnetos', mixture: 'Mixture', starter: 'Start engine', fuel: 'Fuel', flaps: 'Flaps', gear: 'Gear', trim: 'Trim', brakes: 'Brakes',
  axisHelp: 'Pick an action, then move a stick or press a button. Keys: press a key.',
  reset: 'Reset', done: 'Done', wait: 'Loading the flight model…',
};
const ZH = {
  title: 'SFO 飛行', tagline: '駕駛塞斯納 172 或波音 777，從舊金山國際機場飛越真實灣區。',
  aircraft: '機型', c172: '塞斯納 172（輕型單發）', b77w: '波音 777-300ER（重型雙發）',
  start: '起始', startAt: '起始位置', ramp: '停機坪', rampCold: '停機坪（冷艙啟動）', runway: '跑道上', final9: '9 海里最後進場', final3: '3 海里最後進場', ggb: '金門大橋上空',
  weather: '天氣', metar: 'METAR', custom: '自訂', wind: '風', vis: '能見度', time: '時間', lang: '語言', fly: '起飛', resume: '繼續', menu: '選單', replay: '重播', again: '再飛一次', controls: '操控', remap: '搖桿 / 按鍵',
  dawn: '清晨', day: '正午', golden: '黃昏', night: '夜間',
  landed: '已降落', crashed: '墜毀', score: '落地評分', sink: '接地下沉率', centre: '中心線', tdz: '接地區', bounces: '彈跳', stop: '停止', grade: '等級',
  crash: { terrain: '撞上地形', water: '墜入水中', building: '撞上建築', 'hard-landing': '落地過重', overstress: '結構過載', 'gear-up': '未放起落架', nacelle: '發動機觸地', wingtip: '翼尖觸地', nose: '機頭觸地', prop: '螺旋槳觸地' },
  cams: { cockpit: '駕駛艙', chase: '追蹤', tower: '塔台', free: '自由' },
  shots: { establish: '遠景', chase: '追蹤', wing: '機翼', cockpit: '駕駛艙', tower: '塔台', spotter: '跑道旁', rollout: '滑行', side: '跑道側' },
  replaying: '重播', stall: '失速', pull: '拉起', tail: '機尾觸地', parked: '停機剎車', ap: '自動駕駛', apOff: '自動駕駛解除',
  help: '方向鍵 / W S A D 俯仰與滾轉 · Q E 方向舵 · PgUp PgDn 油門 · F 襟翼（Shift+F 收）· G 起落架 · B 剎車（Shift+B 停機）· / 擾流板 · Home End 配平 · Shift+A 自動駕駛 · C 視角 · Y 滑鼠駕駛桿 · Esc 選單',
  helpShort: 'Esc 選單 · C 視角 · H 隱藏',
  mcp: { AP: '自駕', AT: '自動油門', HDG: '航向', ALT: '高度', VS: '垂直速度', SPD: '速度', LOC: '航向道', APP: '進場', AB: '自動剎車' },
  engine: '發動機', master: '總電源', mags: '磁電機', mixture: '混合比', starter: '啟動發動機', fuel: '燃油', flaps: '襟翼', gear: '起落架', trim: '配平', brakes: '剎車',
  axisHelp: '選一個動作，再推搖桿或按按鈕；鍵盤則按一個鍵。',
  reset: '重設', done: '完成', wait: '正在載入飛行模型…',
};
export const T = (lang) => (lang === 'zh' ? ZH : EN);
export const pickLang = (qs) => (qs.get('lang') || (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language) ? 'zh' : 'en')) === 'zh' ? 'zh' : 'en';

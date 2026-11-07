import styles from './HauntedDecor.module.css';

/**
 * What has happened to the set since anyone looked after it: bent aerials, a
 * rotting pumpkin with a candle in it, cobwebs, candle wax, and fingers coming over
 * the top from behind. All of it is outside the tube and takes no clicks, so the
 * clean-feed rule and the wall behind are both untouched.
 */
export function HauntedDecor() {
  return (
    <div className={styles.decor} aria-hidden="true">
      <svg className={styles.aerials} viewBox="0 0 300 130">
        <circle cx="150" cy="122" r="17" fill="#17120e" stroke="#050403" strokeWidth="2" />
        <path d="M145 112 L72 12" stroke="#4b4034" strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M72 12 L70 4" stroke="#6b5e4d" strokeWidth="6" strokeLinecap="round" />
        {/* Snapped, and folded back on itself. */}
        <path d="M156 112 L205 52 L262 66" stroke="#4b4034" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M262 66 L268 66" stroke="#6b5e4d" strokeWidth="6" strokeLinecap="round" />
        <path d="M108 62 Q150 100 202 56 M90 37 Q120 40 124 82 M214 50 Q225 72 246 62" stroke="rgba(214, 208, 190, 0.3)" strokeWidth="0.8" fill="none" />
      </svg>

      <svg className={styles.pumpkin} viewBox="0 0 150 120">
        <defs>
          <radialGradient id="pumpkinSkin" cx="48%" cy="72%" r="72%">
            <stop offset="0" stopColor="#8e4a12" />
            <stop offset="0.55" stopColor="#4a2409" />
            <stop offset="1" stopColor="#140a04" />
          </radialGradient>
          <linearGradient id="pumpkinFlame" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ffcf62" />
            <stop offset="1" stopColor="#c8520e" />
          </linearGradient>
        </defs>
        <path d="M72 22 C70 12 76 6 86 2 L92 9 C85 11 83 16 84 24 Z" fill="#26200f" />
        <ellipse cx="75" cy="72" rx="68" ry="46" fill="url(#pumpkinSkin)" />
        <ellipse cx="42" cy="72" rx="19" ry="43" fill="none" stroke="#0e0703" strokeWidth="3" />
        <ellipse cx="75" cy="72" rx="20" ry="46" fill="none" stroke="#0e0703" strokeWidth="3" />
        <ellipse cx="108" cy="72" rx="19" ry="43" fill="none" stroke="#0e0703" strokeWidth="3" />
        {/* Sagging on one side, and something has been at it. */}
        <path d="M118 100 C130 94 140 86 142 70 C150 92 136 114 112 116 Z" fill="#0b0602" />
        <circle cx="30" cy="92" r="6" fill="#1e2412" opacity="0.8" />
        <circle cx="38" cy="99" r="3.5" fill="#1e2412" opacity="0.8" />
        <g className={styles.flame} fill="url(#pumpkinFlame)">
          <path d="M34 62 L54 48 L58 70 L44 72 Z" />
          <path d="M116 60 L94 46 L90 69 L104 72 Z" />
          <path d="M68 76 L75 66 L82 77 L75 80 Z" />
          <path d="M28 84 L38 88 L44 82 L52 92 L62 85 L71 95 L82 86 L90 94 L100 84 L110 89 L122 82 L114 100 L104 96 L94 106 L82 98 L72 108 L60 99 L50 105 L40 96 L34 100 Z" />
        </g>
      </svg>

      <svg className={styles.candles} viewBox="0 0 90 100">
        <rect x="16" y="28" width="16" height="72" fill="#b0a68c" />
        <rect x="46" y="52" width="20" height="48" fill="#8f8570" />
        <path d="M16 28 q8 -5 16 0 v7 q-3 9 -5 1 q-3 12 -6 3 q-3 7 -5 -2 Z" fill="#cfc5a9" />
        <path d="M46 52 q10 -5 20 0 v6 q-3 13 -6 2 q-5 8 -7 -1 q-3 5 -7 -1 Z" fill="#a89e86" />
        <path d="M24 28 v-6 M56 52 v-6" stroke="#0a0806" strokeWidth="2" />
        <g className={styles.flame}>
          <path d="M24 2 C31 12 29 21 24 22 C19 21 17 12 24 2 Z" fill="#f4a93c" />
          <path d="M56 27 C62 36 60 45 56 46 C52 45 50 36 56 27 Z" fill="#f4a93c" />
          <path d="M24 12 C27 17 26 21 24 21 C22 21 21 17 24 12 Z" fill="#ffe9a8" />
          <path d="M56 36 C59 41 58 45 56 45 C54 45 53 41 56 36 Z" fill="#ffe9a8" />
        </g>
      </svg>

      <svg className={styles.fingers} viewBox="0 0 150 80">
        <defs>
          <linearGradient id="fingerSkin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6e6a5e" />
            <stop offset="1" stopColor="#23211c" />
          </linearGradient>
        </defs>
        <g fill="url(#fingerSkin)" stroke="#070605" strokeWidth="1.5">
          <path d="M12 12 C14 3 26 3 28 13 L30 62 L24 78 L18 62 Z" />
          <path d="M42 8 C44 -1 57 -1 59 9 L60 66 L52 80 L45 66 Z" />
          <path d="M72 7 C74 -2 88 -2 90 8 L90 70 L82 80 L75 70 Z" />
          <path d="M104 10 C106 2 119 2 121 11 L120 60 L113 76 L106 60 Z" />
        </g>
        <path d="M16 30 h10 M47 28 h10 M78 28 h10 M109 28 h9 M18 48 h9 M49 50 h9 M79 52 h9 M110 46 h8" stroke="#141310" strokeWidth="1.5" />
      </svg>

      <svg className={styles.webLeft} viewBox="0 0 200 170">
        <g stroke="rgba(216, 212, 196, 0.34)" strokeWidth="0.9" fill="none">
          <path d="M0 0 L196 8 M0 0 L176 72 M0 0 L120 130 M0 0 L52 164 M0 0 L8 120" />
          <path d="M40 2 Q36 16 35 15 Q28 24 27 28 Q16 30 11 33 Q6 28 4 25 M80 4 Q72 28 71 30 Q56 48 54 56 Q32 60 23 66 Q10 58 6 50 M124 5 Q112 44 111 46 Q84 74 79 84 Q50 92 34 100 Q14 90 7 76 M168 7 Q152 58 152 62 Q114 102 104 113 Q68 124 46 142 Q20 120 8 102" />
        </g>
        <path d="M120 0 V52" stroke="rgba(216, 212, 196, 0.34)" strokeWidth="0.8" />
        <ellipse cx="120" cy="58" rx="5" ry="7" fill="#050403" />
        <circle cx="120" cy="49" r="3" fill="#050403" />
        <path d="M116 54 L106 46 M116 58 L104 58 M116 62 L107 72 M124 54 L134 46 M124 58 L136 58 M124 62 L133 72" stroke="#050403" strokeWidth="1.1" />
      </svg>

      <svg className={styles.webRight} viewBox="0 0 170 150">
        <g stroke="rgba(216, 212, 196, 0.3)" strokeWidth="0.9" fill="none">
          <path d="M170 150 L6 142 M170 150 L30 76 M170 150 L82 22 M170 150 L150 8" />
          <path d="M128 148 Q120 132 122 128 Q130 114 134 110 Q148 100 155 100 M86 146 Q74 118 78 110 Q96 82 102 72 Q130 60 152 58 M48 144 Q34 106 40 94 Q68 58 80 42 Q118 30 150 24" />
        </g>
      </svg>
    </div>
  );
}

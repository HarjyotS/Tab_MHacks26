// The design's small iMessage SVGs, defined once in a sprite (<PhoneSprite />,
// rendered once per page) and referenced with <use>, so five phones don't
// repeat the same path data in the HTML.

export function PhoneSprite() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', overflow: 'hidden' }}>
      <defs>
        <symbol id="ph-back" viewBox="0 0 17 26">
          <path d="M12.5 3.5 L3.5 13 L12.5 22.5" fill="none" stroke="#007AFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="ph-video" viewBox="0 0 30 22">
          <rect x="1.5" y="3" width="19" height="16" rx="4" fill="none" stroke="#007AFF" strokeWidth="2" />
          <path d="M20.5 9.5 L28 5 V17 L20.5 12.5 Z" fill="none" stroke="#007AFF" strokeWidth="2" strokeLinejoin="round" />
        </symbol>
        <symbol id="ph-chev" viewBox="0 0 4 7">
          <path d="M3.20862 6.86584C3.29873 6.95265 3.40842 7 3.53379 7C3.79628 7 4 6.79481 4 6.53438C4 6.40417 3.94907 6.28579 3.85896 6.19504L1.11655 3.49605L3.85896 0.80496C3.94907 0.714205 4 0.591883 4 0.465614C4 0.205186 3.79628 0 3.53379 0C3.40842 0 3.29873 0.0473506 3.21254 0.13416L0.164545 3.13303C0.0548482 3.23563 0 3.36189 0 3.5C0 3.63811 0.0548482 3.75648 0.160627 3.86302L3.20862 6.86584Z" fill="#C9C9CB" />
        </symbol>
        <symbol id="ph-status" viewBox="0 0 78.328 13">
          <rect opacity="0.35" x="51.5" y="0.5" width="24" height="12" rx="3.8" stroke="black" fill="none" />
          <path opacity="0.4" d="M77 4.78113V8.8566C77.8047 8.51143 78.328 7.70847 78.328 6.81886C78.328 5.92926 77.8047 5.1263 77 4.78113" fill="black" />
          <rect x="53" y="2" width="21" height="9" rx="2.5" fill="black" />
          <path fillRule="evenodd" clipRule="evenodd" d="M35.2705 3.10398C37.7576 3.10408 40.1496 4.02616 41.9521 5.67964C42.0879 5.8073 42.3048 5.80569 42.4385 5.67603L43.736 4.41257C43.8037 4.34681 43.8414 4.25773 43.8409 4.16505C43.8403 4.07237 43.8015 3.98372 43.733 3.91873C39.002 -0.455983 31.5383 -0.455983 26.8073 3.91873C26.7387 3.98368 26.6999 4.07229 26.6992 4.16497C26.6986 4.25766 26.7363 4.34676 26.8039 4.41257L28.1018 5.67603C28.2354 5.80588 28.4525 5.8075 28.5881 5.67964C30.3909 4.02606 32.7832 3.10397 35.2705 3.10398ZM35.2672 7.32425C36.6245 7.32417 37.9334 7.83591 38.9395 8.76004C39.0756 8.89119 39.2899 8.88835 39.4226 8.75363L40.7099 7.43432C40.7777 7.36512 40.8153 7.27124 40.8143 7.17369C40.8133 7.07614 40.7738 6.98306 40.7047 6.91527C37.6408 4.02442 32.8961 4.02442 29.8323 6.91527C29.7631 6.98306 29.7236 7.07619 29.7227 7.17377C29.7218 7.27135 29.7595 7.36522 29.8274 7.43432L31.1143 8.75363C31.247 8.88835 31.4614 8.89119 31.5974 8.76004C32.6029 7.83652 33.9107 7.32482 35.2672 7.32425ZM37.7916 10.1178C37.7935 10.2232 37.7565 10.3247 37.6892 10.3985L35.5125 12.8533C35.4487 12.9254 35.3617 12.966 35.2709 12.966C35.1802 12.966 35.0932 12.9254 35.0294 12.8533L32.8523 10.3985C32.7851 10.3247 32.7481 10.2231 32.7501 10.1177C32.7521 10.0124 32.7929 9.9126 32.8629 9.84199C34.253 8.52809 36.2889 8.52809 37.679 9.84199C37.7489 9.91266 37.7897 10.0125 37.7916 10.1178Z" fill="black" />
          <path fillRule="evenodd" clipRule="evenodd" d="M19.2 1.68199C19.2 1.04895 18.7224 0.535767 18.1333 0.535767H17.0667C16.4776 0.535767 16 1.04895 16 1.68199V11.616C16 12.249 16.4776 12.7622 17.0667 12.7622H18.1333C18.7224 12.7622 19.2 12.249 19.2 11.616V1.68199ZM11.7659 2.98105H12.8326C13.4217 2.98105 13.8992 3.50655 13.8992 4.15478V11.5884C13.8992 12.2367 13.4217 12.7622 12.8326 12.7622H11.7659C11.1768 12.7622 10.6992 12.2367 10.6992 11.5884V4.15478C10.6992 3.50655 11.1768 2.98105 11.7659 2.98105ZM7.43411 5.6301H6.36745C5.77834 5.6301 5.30078 6.16229 5.30078 6.81878V11.5735C5.30078 12.23 5.77834 12.7622 6.36745 12.7622H7.43411C8.02322 12.7622 8.50078 12.23 8.50078 11.5735V6.81878C8.50078 6.16229 8.02322 5.6301 7.43411 5.6301ZM2.13333 8.07539H1.06667C0.477563 8.07539 0 8.59998 0 9.24709V11.5905C0 12.2376 0.477563 12.7622 1.06667 12.7622H2.13333C2.72244 12.7622 3.2 12.2376 3.2 11.5905V9.24709C3.2 8.59998 2.72244 8.07539 2.13333 8.07539Z" fill="black" />
        </symbol>
        <symbol id="ph-plus" viewBox="0 0 34 34">
          <circle cx="17" cy="17" r="17" fill="#E9E9EB" />
          <path d="M17 11 V23 M11 17 H23" stroke="#909093" strokeWidth="2" strokeLinecap="round" />
        </symbol>
        <symbol id="ph-mic" viewBox="0 0 12 17">
          <rect x="3" y="1" width="6" height="10" rx="3" fill="#A2A1A3" />
          <path d="M1 8 C1 11.5 3.5 13.5 6 13.5 C8.5 13.5 11 11.5 11 8 M6 13.5 V16" fill="none" stroke="#A2A1A3" strokeWidth="1.5" strokeLinecap="round" />
        </symbol>
        {/* No fill on these two: each use sets its own color. */}
        <symbol id="ph-tail" viewBox="0 0 16.5 17">
          <path d="M5 10.5C4.49857 13.5086 1.66667 16.3333 0 17C6.4 17 10.5 14.8333 11.5 13.5L16.5 15L16 0H5.5V2V4V4.5C5.5 5.5 5.5 7.5 5 10.5Z" />
        </symbol>
        <symbol id="ph-dots" viewBox="0 0 35 41.8682">
          <path d="M2.36035 37.1514C3.66267 37.1516 4.71963 38.2074 4.71973 39.5098C4.71973 40.8122 3.66272 41.868 2.36035 41.8682C1.05782 41.8682 0 40.8123 0 39.5098C9.21304e-05 38.2073 1.05787 37.1514 2.36035 37.1514ZM19 0C27.8366 0 35 7.16344 35 16C35 24.8366 27.8366 32 19 32C17.1605 32 15.394 31.6885 13.749 31.1172V31.4824C13.7489 34.2519 11.5038 36.4969 8.73438 36.4971C5.96475 36.4971 3.71888 34.252 3.71875 31.4824V31.0449C3.71889 28.945 5.01032 27.1473 6.8418 26.4004C4.44697 23.6034 3 19.9708 3 16C3 7.16344 10.1634 0 19 0Z" />
        </symbol>
      </defs>
    </svg>
  )
}

function Use({ id, className, width, height }: { id: string; className?: string; width: number; height: number }) {
  return (
    <svg className={className} width={width} height={height} aria-hidden="true" focusable="false">
      <use href={'#' + id} />
    </svg>
  )
}

export const BackIcon = () => <Use id="ph-back" width={17} height={26} />
export const VideoIcon = () => <Use id="ph-video" width={30} height={22} />
export const ChevronIcon = () => <Use id="ph-chev" className="phone__chev" width={4} height={7} />
export const StatusIcons = () => <Use id="ph-status" className="phone__status-icons" width={78.328} height={13} />

export function ComposerIcons() {
  return (
    <div className="phone__composer">
      <span className="phone__plus">
        <Use id="ph-plus" width={34} height={34} />
      </span>
      <div className="phone__field">
        <span>iMessage</span>
        <Use id="ph-mic" width={12} height={17} />
      </div>
    </div>
  )
}

export function Tail({ out }: { out?: boolean }) {
  return <Use id="ph-tail" className={out ? 't-tail t-tail--out' : 't-tail t-tail--in'} width={16.5} height={17} />
}

/** Tapback bubble: blue on incoming messages, gray on your own (as in iOS). */
export function TapbackShape({ incoming }: { incoming: boolean }) {
  return <Use id="ph-dots" className={'t-react__dots ' + (incoming ? 't-react__dots--in' : 't-react__dots--out')} width={35} height={41.87} />
}

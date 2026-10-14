// Gen2Playground: a short kit sheet for the pieces the two cuts don't show
// on their own (the glass "N days later" card, an in-phone notification flood,
// the receipt unfurl). The story itself lives in TabTableFull / TabTableShort.
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Audit } from '../audit';
import { useFonts } from '../fonts';
import { Grain } from '../grain';
import { Contacts, GROUP, HEADER, ME } from './cast';
import { ChatBackdrop, ChatPhone, GThread, NotifStack } from './chatChaos';
import { RECEIPT } from './data';
import { DaysLater, Media, Window } from './kit';
import { ReceiptScroll, useReceiptFont } from './receipt';
import { CUTS } from './timeline';

export const PLAYGROUND_FRAMES = 300;

export const Gen2Playground: React.FC<{ audit?: boolean }> = ({ audit = false }) => {
  useFonts();
  useReceiptFont();
  const items = CUTS.full.chat.msgs.filter((m) => !m.system && m.text && m.from !== ME && m.from !== 'Tab').slice(0, 10)
    .map((m, i) => ({ at: 72 + i * 9, title: m.from, body: m.text!, app: GROUP, icon: m.from }));
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Window from={0} to={60}>
        <Media id="M7" label="exhale" clip="gen2/clips/M7.mp4" still="gen2/stills/H10.png" />
        <DaysLater text="3 days later" from={0} to={60} variant="glass" />
      </Window>
      <Window from={60} to={180}>
        <Contacts>
          <ChatBackdrop still="gen2/stills/H02.png" />
          <ChatPhone title={GROUP} members={HEADER} unread={[{ at: 60, v: 20 }, { at: 170, v: 160 }]} overlay={<div data-overlay="1"><NotifStack items={items} x={12} y={64} width={504} iconSize={64} /></div>}>
            <GThread msgs={[{ id: 'k1', at: 0, from: '', text: 'Mon 9:41 AM', system: true }, { id: 'k2', at: 0, from: ME, text: 'can you guys send the money' }]} me={ME} />
          </ChatPhone>
          <NotifStack items={items.map((it) => ({ ...it, at: it.at + 4 }))} x={890} y={70} width={880} />
        </Contacts>
      </Window>
      <Window from={180} to={PLAYGROUND_FRAMES}>
        <ReceiptScroll data={RECEIPT} unfurl={{ from: 184, to: 292, s: 1 }} />
      </Window>
      <Grain />
      {audit && <Audit every={10} safe={48} />}
    </AbsoluteFill>
  );
};

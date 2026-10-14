import React from 'react';
import { Composition } from 'remotion';
import { Main } from './Main';
import { FPS, H, TOTAL, W } from './timeline';
import { Gen2Playground, PLAYGROUND_FRAMES } from './gen2/Playground';
import { FULL_FRAMES, SHORT_FRAMES, TabTableFull, TabTableShort } from './gen2/Film';
import { EXPLAIN_FRAMES, ExplainBank, ExplainGate, ExplainNeverLeave, ExplainSafety } from './explainers';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="TabPromo" component={Main} durationInFrames={TOTAL} fps={FPS} width={W} height={H} defaultProps={{ bgm: true, variant: 1 }} />
    <Composition id="TabTableFull" component={TabTableFull} durationInFrames={FULL_FRAMES} fps={30} width={1920} height={1080} defaultProps={{ audit: false, bgm: true }} />
    <Composition id="TabTableShort" component={TabTableShort} durationInFrames={SHORT_FRAMES} fps={30} width={1920} height={1080} defaultProps={{ audit: false, bgm: true }} />
    <Composition id="ExplainGate" component={ExplainGate} durationInFrames={EXPLAIN_FRAMES} fps={30} width={1920} height={1080} />
    <Composition id="ExplainSafety" component={ExplainSafety} durationInFrames={EXPLAIN_FRAMES} fps={30} width={1920} height={1080} />
    <Composition id="ExplainBank" component={ExplainBank} durationInFrames={EXPLAIN_FRAMES} fps={30} width={1920} height={1080} />
    <Composition id="ExplainNeverLeave" component={ExplainNeverLeave} durationInFrames={EXPLAIN_FRAMES} fps={30} width={1920} height={1080} />
    <Composition id="Gen2Playground" component={Gen2Playground} durationInFrames={PLAYGROUND_FRAMES} fps={30} width={1920} height={1080} defaultProps={{ audit: false }} />
  </>
);

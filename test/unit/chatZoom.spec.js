import { expect } from 'chai'
import { CHAT_ZOOM_LEVELS, applyChatZoomAction, normalizeChatZoom, stepChatZoom } from '../../src/renderer/utils/chatZoom'
import { createDefaultSettings } from '../../src/common/constants'

describe('Chat zoom', () => {
  it('starts at 100%', () => {
    expect(createDefaultSettings().chat.zoom).to.equal(1)
  })

  it('steps through the zoom levels and stops at the limits', () => {
    expect(stepChatZoom(1, 1)).to.equal(1.1)
    expect(stepChatZoom(1.1, 1)).to.equal(1.25)
    expect(stepChatZoom(1, -1)).to.equal(0.9)
    expect(stepChatZoom(0.9, -1)).to.equal(0.75)
    expect(stepChatZoom(0.75, -1)).to.equal(0.75)
    expect(stepChatZoom(2, 1)).to.equal(2)
  })

  it('snaps an in-between value to the next level', () => {
    expect(stepChatZoom(1.2, 1)).to.equal(1.25)
    expect(stepChatZoom(1.2, -1)).to.equal(1.1)
  })

  it('treats bad stored values as 100% and clamps others', () => {
    for (const bad of [undefined, null, '', 'big', NaN, 0, -1, Infinity]) {
      expect(normalizeChatZoom(bad), String(bad)).to.equal(1)
    }
    expect(normalizeChatZoom('1.5')).to.equal(1.5)
    expect(normalizeChatZoom(9)).to.equal(CHAT_ZOOM_LEVELS[CHAT_ZOOM_LEVELS.length - 1])
    expect(normalizeChatZoom(0.1)).to.equal(CHAT_ZOOM_LEVELS[0])
  })

  it('applies zoom in, out and reset actions', () => {
    expect(applyChatZoomAction(1, 'in')).to.equal(1.1)
    expect(applyChatZoomAction(1, 'out')).to.equal(0.9)
    expect(applyChatZoomAction(1.75, 'reset')).to.equal(1)
  })
})

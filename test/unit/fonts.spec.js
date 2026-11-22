import { expect } from 'chai'
import { DEFAULT_SETTINGS } from '../../src/common/constants'
import { SYSTEM_FONT_STACK, fontOptionValue } from '../../src/renderer/utils/fonts'

describe('Font picker values', () => {
  it('matches the default font setting to the System Default option', () => {
    expect(fontOptionValue(DEFAULT_SETTINGS.markdown.fontFamily)).to.equal(SYSTEM_FONT_STACK)
  })

  it('treats a missing or bare system-ui font as System Default', () => {
    expect(fontOptionValue(undefined)).to.equal(SYSTEM_FONT_STACK)
    expect(fontOptionValue('system-ui')).to.equal(SYSTEM_FONT_STACK)
  })

  it('leaves single-quoted values unchanged', () => {
    expect(fontOptionValue("'Georgia', serif")).to.equal("'Georgia', serif")
    expect(fontOptionValue('"Times New Roman", serif')).to.equal("'Times New Roman', serif")
  })
})

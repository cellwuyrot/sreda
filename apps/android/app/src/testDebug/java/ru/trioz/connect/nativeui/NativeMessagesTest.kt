package ru.trioz.connect.nativeui

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativeMessagesTest {
    @Test fun cursorAndIdAreEncoded() {
        assertEquals("/api/dm/a%2Fb?limit=50&cursor=x%26y", historyPath("a/b", true, "x&y"))
        assertEquals("/api/messages?channelId=a%3Fb&limit=50", historyPath("a?b", false))
    }
    @Test fun nullCursorMeansEnd() {
        assertNull(parseMessagePage("""{"messages":[],"nextCursor":null}""").cursor)
    }
    @Test fun pausedIsNotAnOrdinaryEmptyHistory() {
        assertTrue(parseMessagePage("""{"messages":[],"paused":true}""").paused)
    }
    @Test fun malformedPageIsRejected() {
        assertThrows(Exception::class.java) { parseMessagePage("{}") }
        assertThrows(Exception::class.java) { parseMessagePage("""{"messages":[{"content":"oops"}]}""") }
    }
    @Test fun mergeKeepsOrderAndNewerCopy() {
        val merged = mergeHistory(listOf(JSONObject("""{"id":"z"}"""), JSONObject("""{"id":"a","content":"old"}""")), listOf(JSONObject("""{"id":"a","content":"new"}""")))
        assertEquals(listOf("z", "a"), merged.map { it.getString("id") })
        assertEquals("new", merged.last().getString("content"))
    }
    @Test fun deletedAndEncryptedTextNeverRendered() {
        assertEquals("Сообщение удалено", messageText(JSONObject("""{"deleted":true,"content":"secret"}""")))
        assertFalse(messageText(JSONObject("""{"encrypted":true,"content":"secret"}""")).contains("secret"))
        assertFalse(messageText(JSONObject("""{"content":"e2ee:secret"}""")).contains("secret"))
    }
    @Test fun ordinaryTextAndNullAreHandled() {
        assertEquals("Привет", messageText(JSONObject("""{"content":"Привет"}""")))
        assertEquals("Сообщение без текста или вложение", messageText(JSONObject("""{"content":null}""")))
    }
    @Test fun textValidationMatchesFreeAndPremiumLimits() {
        assertNull(channelTextError("я".repeat(12500), false))
        assertNotNull(channelTextError("я".repeat(12501), false))
        assertNull(channelTextError("я".repeat(25000), true))
        assertNotNull(channelTextError("я".repeat(25001), true))
        assertNotNull(channelTextError("я ".repeat(2001), false))
        assertNull(channelTextError("я ".repeat(2001), true))
        assertNotNull(channelTextError(" ", false))
        assertNotNull(channelTextError("e2ee:raw", true))
    }
}

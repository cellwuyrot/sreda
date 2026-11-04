package ru.trioz.connect.nativeui
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NativePreviewTest {
    @Test fun secureConversationNeverShowsServerContent() {
        assertEquals("Защищённая переписка", preview(JSONObject("""{"secure":true,"lastMessage":{"content":"private"}}""")))
    }
    @Test fun encryptedContentNeverAppearsInPreview() {
        assertEquals("Зашифрованное сообщение", preview(JSONObject("""{"lastMessage":{"content":"e2ee:v2:deadbeef"}}""")))
    }
    @Test fun ordinaryContentIsVisible() {
        assertEquals("Привет", preview(JSONObject("""{"lastMessage":{"content":"Привет"}}""")))
    }
    @Test fun absentTextIsExplicit() {
        assertEquals("Нет текстового сообщения", preview(JSONObject("{}")))
    }
}

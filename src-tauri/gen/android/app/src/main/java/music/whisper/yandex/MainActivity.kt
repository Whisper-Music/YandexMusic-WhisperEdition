package music.whisper.yandex

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

// Своё у Android-версии Whisper (остальное в gen/android генерирует Tauri — эти файлы руками не правим).
class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  // отступы системных панелей в CSS-пикселях: top, right, bottom, left
  @Volatile private var insets = "0,0,0,0"

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Кнопка «Назад». У страницы своя навигация (navigate() в main.js), а без этого «Назад» закрыло бы приложение
    // вместе с музыкой. Страница приложения отвечает через window.whisperBack() (mobile.js): закрыла окно или
    // перешла назад — "true"; ничего открыто не было — "bg": приложение уходит в фон, как у музыкальных плееров.
    // Чужая страница (вход в Яндекс — window.whisperBack там нет) — обычный шаг назад в WebView.
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val wv = webView ?: run { moveTaskToBack(true); return }
        wv.evaluateJavascript("(function(){try{return window.whisperBack?String(window.whisperBack()):'none'}catch(e){return 'bg'}})()") { r ->
          when (r?.trim('"')) {
            "true" -> {}
            "none" -> if (wv.canGoBack()) wv.goBack() else moveTaskToBack(true)
            else -> moveTaskToBack(true)
          }
        }
      }
    })
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    // Отступы от строки состояния, выреза камеры и полоски жестов. В CSS есть env(safe-area-inset-*), но старые
    // WebView (до ~2025 года) на Android всегда отдают там 0 — поэтому сообщаем их сами: страница читает
    // WhisperAndroid.insets() при запуске (mobile.js), а при смене (поворот экрана) получает window.whisperInsets(…).
    // В интерфейсе — только эти четыре числа: он виден любой странице в окне, в том числе странице входа Яндекса.
    webView.addJavascriptInterface(object {
      @JavascriptInterface fun insets(): String = this@MainActivity.insets
    }, "WhisperAndroid")
    ViewCompat.setOnApplyWindowInsetsListener(webView) { v, w ->
      val b = w.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val d = resources.displayMetrics.density
      insets = listOf(b.top, b.right, b.bottom, b.left).joinToString(",") { (it / d).toInt().toString() }
      v.post { webView.evaluateJavascript("window.whisperInsets&&window.whisperInsets('$insets')", null) }
      w
    }
  }
}

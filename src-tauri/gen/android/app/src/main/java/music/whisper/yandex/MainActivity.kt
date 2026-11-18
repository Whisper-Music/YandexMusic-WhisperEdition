package music.whisper.yandex

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import androidx.activity.SystemBarStyle
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

// Своё у Android-версии Whisper (остальное в gen/android генерирует Tauri — эти файлы руками не правим):
// отступы системных панелей, кнопка «Назад», разрешения, мост к плееру в уведомлении (MediaService.kt).
class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  // отступы системных панелей в CSS-пикселях: top, right, bottom, left
  @Volatile private var insets = "0,0,0,0"
  private var notifyAsked = false

  override fun onCreate(savedInstanceState: Bundle?) {
    // Строка состояния и полоска жестов прозрачные и со светлыми значками: под ними — тёмный интерфейс приложения
    // (подложку под нижней панелью рисует mobile.css). Без этого Android клал под кнопки навигации светлую плашку.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.isNavigationBarContrastEnforced = false

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

    askFirstRun()
  }

  override fun onDestroy() {
    MediaService.onAction = null
    MediaService.stop(this)
    super.onDestroy()
  }

  /** При первом запуске — все разрешения разом: уведомления (плеер в шторке) и файлы (свои треки, обои). */
  private fun askFirstRun() {
    val prefs = getSharedPreferences("whisper", MODE_PRIVATE)
    if (prefs.getBoolean("asked_perms", false)) return
    prefs.edit().putBoolean("asked_perms", true).apply()
    val need = permissions().filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
    if (need.isNotEmpty()) requestPermissions(need.toTypedArray()) { }
  }

  private fun permissions(): List<String> =
    if (Build.VERSION.SDK_INT >= 33) {
      listOf(
        Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.READ_MEDIA_AUDIO,
        Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO
      )
    } else {
      listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

  /** Уведомления выключены, а музыка пошла — спросить ещё раз (один раз за запуск: Android и так даёт спросить ≤2 раз). */
  private fun askNotify() {
    if (Build.VERSION.SDK_INT < 33 || notifyAsked) return
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
    notifyAsked = true
    runOnUiThread { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS)) { } }
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    // Мост к странице. В нём только безопасное: отступы панелей и «что играет» для уведомления — он виден любой
    // странице в окне, в том числе странице входа Яндекса (худшее, что она может, — поменять текст уведомления).
    webView.addJavascriptInterface(Bridge(), "WhisperAndroid")
    MediaService.onAction = { a, pos ->
      runOnUiThread {
        webView.evaluateJavascript("window.whisperMediaAction&&window.whisperMediaAction('$a',$pos)", null)
      }
    }
    // Отступы от строки состояния, выреза камеры и полоски жестов. В CSS есть env(safe-area-inset-*), но старые
    // WebView (до ~2025 года) на Android всегда отдают там 0 — поэтому сообщаем их сами: страница читает
    // WhisperAndroid.insets() при запуске (mobile.js), а при смене (поворот экрана) получает window.whisperInsets(…).
    ViewCompat.setOnApplyWindowInsetsListener(webView) { v, w ->
      val b = w.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val d = resources.displayMetrics.density
      insets = listOf(b.top, b.right, b.bottom, b.left).joinToString(",") { (it / d).toInt().toString() }
      v.post { webView.evaluateJavascript("window.whisperInsets&&window.whisperInsets('$insets')", null) }
      w
    }
  }

  inner class Bridge {
    @JavascriptInterface fun insets(): String = this@MainActivity.insets

    /** Что играет: { title, artist, cover, duration, position (мс), playing } — mobilemedia.js. Пустой title — трека нет. */
    @JavascriptInterface fun media(json: String) {
      val j = try { JSONObject(json) } catch (_: Exception) { return }
      val title = j.optString("title").take(300)
      if (title.isEmpty()) {
        MediaService.stop(this@MainActivity)
        return
      }
      val playing = j.optBoolean("playing")
      if (playing) askNotify()
      runOnUiThread {
        MediaService.update(
          this@MainActivity,
          MediaService.State(
            title, j.optString("artist").take(300), j.optString("cover").take(2000),
            j.optLong("duration").coerceAtLeast(0), j.optLong("position").coerceAtLeast(0), playing
          )
        )
      }
    }
  }
}

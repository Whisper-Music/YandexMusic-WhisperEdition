package music.whisper.yandex

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
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
    takeIntent(intent)
  }

  // Приложение уже открыто (launchMode singleTask) — «Открыть с помощью» приходит сюда
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    takeIntent(intent)
  }

  // ---------- файл темы из другого приложения ----------
  // Тему (.wmt) открыли из Telegram или файлового менеджера («Открыть с помощью» → Whisper) или отправили через
  // «Поделиться». Файл копируется в кэш приложения, страница забирает его кусками через мост (incoming*) и ставит
  // тем же путём, что «Загрузить тему…» (mobile.js → window.wmtImport). Ссылка content:// живёт недолго — поэтому
  // копия, а не чтение по ссылке потом.
  private val incomingMax = 64L * 1024 * 1024      // как WMT.MAX_FILE (core/wmt.js)
  @Volatile private var incomingInfo = ""

  private fun takeIntent(intent: Intent?) {
    val i = intent ?: return
    val uri: Uri = when (i.action) {
      Intent.ACTION_VIEW -> i.data
      Intent.ACTION_SEND ->
        if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else @Suppress("DEPRECATION") i.getParcelableExtra(Intent.EXTRA_STREAM)
      else -> null
    } ?: return
    if (uri.scheme != "content" && uri.scheme != "file") return    // whisper://… — это ссылки, их разбирает deeplink.rs
    i.action = Intent.ACTION_MAIN                                    // поворот экрана не откроет тот же файл второй раз
    Thread {
      incomingInfo = copyIncoming(uri)
      runOnUiThread { webView?.evaluateJavascript("window.whisperIncoming&&window.whisperIncoming()", null) }
    }.start()
  }

  private fun incomingFile() = java.io.File(cacheDir, "incoming.bin")

  /** Копия файла в кэш; ответ для страницы — { name, size } или { name, error }. */
  private fun copyIncoming(uri: Uri): String {
    val j = JSONObject()
    var name = uri.lastPathSegment?.substringAfterLast('/') ?: "file"
    try {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst() && !c.isNull(0)) name = c.getString(0)
      }
    } catch (_: Exception) {}
    j.put("name", name.take(200))
    try {
      val out = incomingFile()
      var total = 0L
      contentResolver.openInputStream(uri)?.use { inp ->
        out.outputStream().use { o ->
          val buf = ByteArray(64 * 1024)
          while (true) {
            val n = inp.read(buf)
            if (n < 0) break
            total += n
            if (total > incomingMax) { j.put("error", "big"); break }
            o.write(buf, 0, n)
          }
        }
      } ?: j.put("error", "не удалось открыть")
      if (!j.has("error")) j.put("size", total) else out.delete()
    } catch (e: Exception) {
      incomingFile().delete()
      j.put("error", e.message ?: "ошибка чтения")
    }
    return j.toString()
  }

  // Музыка в фоне. WryActivity.onPause зовёт WebView.onPause() — страница считается скрытой, а скрытой странице
  // Chromium не начинает грузить новый трек: следующий не включался до возвращения в приложение. Музыкальному
  // плееру пауза страницы не нужна — сразу снимаем её. Рисование в фоне от этого не идёт: экрана нет.
  // (Скачанный трек на Android отдаётся одним ответом целиком — download.rs LOCAL_CHUNK: продолжение по Range
  // встроенный браузер не дожидался, и трек замолкал на конце первого куска.)
  override fun onPause() {
    super.onPause()
    keepPageAwake()
  }

  // Экран выключили или ушли в другое приложение: окно приложения скрывается, и WebView сообщает странице
  // «не видно». Скрытой странице Chromium не грузит новые треки (src у <audio> не начинает загружаться, пока
  // страницу снова не покажут) — следующий трек не включался до возвращения в приложение. Говорим WebView,
  // что окно видно (так же делают плагины фонового режима Cordova); кадры всё равно не рисуются — экрана нет.
  override fun onStop() {
    super.onStop()
    keepPageAwake()
  }

  private fun keepPageAwake() {
    val wv = webView ?: return
    val wake = Runnable {
      wv.onResume()
      wv.dispatchWindowVisibilityChanged(android.view.View.VISIBLE)
    }
    wake.run()
    // окно прячется не сразу, а уже после onStop (и при выключении экрана — ещё позже): WebView получает
    // «окно скрыто» позже нас — повторяем, когда это уже случилось
    for (ms in longArrayOf(300, 1000, 3000)) wv.postDelayed(wake, ms)
    // страница теперь «видна» и в фоне — видеообои ей останавливать самой (mobile.js → whisperBg)
    wv.evaluateJavascript("window.whisperBg&&window.whisperBg(true)", null)
  }

  override fun onResume() {
    super.onResume()
    webView?.evaluateJavascript("window.whisperBg&&window.whisperBg(false)", null)
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
    // Процесс страницы (renderer) по умолчанию теряет приоритет, когда окна не видно, — Android может его
    // заморозить или выгрузить вместе с играющей музыкой. Держим его важным и в фоне (Android 8+).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
    }
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

    /** Файл, открытый из другого приложения: JSON { name, size } / { name, error } или "" — ничего не пришло. */
    @JavascriptInterface fun incoming(): String = incomingInfo

    /** Кусок этого файла в base64 (страница собирает его в Uint8Array по 1 МБ — одна строка на 64 МБ не пролезла бы). */
    @JavascriptInterface fun incomingRead(offset: Long, length: Int): String {
      val f = incomingFile()
      if (!f.exists() || offset < 0 || length <= 0) return ""
      java.io.RandomAccessFile(f, "r").use { r ->
        if (offset >= r.length()) return ""
        r.seek(offset)
        val b = ByteArray(minOf(length.toLong(), 4L * 1024 * 1024, r.length() - offset).toInt())
        r.readFully(b)
        return Base64.encodeToString(b, Base64.NO_WRAP)
      }
    }

    /** Страница забрала файл (или он не тема) — копия больше не нужна. */
    @JavascriptInterface fun incomingDone() {
      incomingInfo = ""
      incomingFile().delete()
    }

    /**
     * Поставить скачанное обновление (apkupdate.rs кладёт его в кэш как update.apk): системное окно «Обновить?».
     * Путь не передаётся — мост виден и странице входа Яндекса, ставить она может только этот файл, а Android
     * примет его, лишь если он подписан тем же ключом, что и приложение.
     * "ok" — окно открыто; "perm" — сначала надо разрешить установку из приложения (открыты настройки);
     * "missing" — файла нет; иначе — текст ошибки.
     */
    @JavascriptInterface fun installUpdate(): String {
      val f = java.io.File(cacheDir, "update.apk")
      if (!f.exists()) return "missing"
      return try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
          startActivity(Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
          return "perm"
        }
        val uri = androidx.core.content.FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", f)
        startActivity(Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, "application/vnd.android.package-archive")
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        })
        "ok"
      } catch (e: Exception) {
        e.message ?: "error"
      }
    }

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

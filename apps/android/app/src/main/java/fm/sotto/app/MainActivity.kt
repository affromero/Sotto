package fm.sotto.app

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import fm.sotto.app.play.setForeground
import fm.sotto.app.ui.PlayRoot
import fm.sotto.app.ui.SottoTheme

class MainActivity : ComponentActivity() {
    private val model: SottoViewModel by viewModels()
    private var resumed = false
    private var focused = false
    private var topResumed = Build.VERSION.SDK_INT < 29

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        setContent { SottoTheme { PlayRoot(model.play) } }
        if (savedInstanceState == null) dispatchInvitation(intent)
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        dispatchInvitation(intent)
    }
    private fun dispatchInvitation(intent: Intent) {
        if (intent.action == Intent.ACTION_VIEW) intent.dataString?.let(model::openLink)
    }
    override fun onResume() { super.onResume(); resumed = true; updatePresence() }
    override fun onPause() { resumed = false; updatePresence(); super.onPause() }
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        focused = hasFocus
        updatePresence()
    }
    override fun onTopResumedActivityChanged(isTopResumedActivity: Boolean) {
        super.onTopResumedActivityChanged(isTopResumedActivity)
        topResumed = isTopResumedActivity
        updatePresence()
    }
    private fun updatePresence() { model.play.setForeground(resumed && focused && topResumed) }
}

package fm.sotto.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily

private val LightColors = lightColorScheme(
    primary = Color(0xFF3F4FB0), onPrimary = Color.White, background = Color(0xFFF5F4F0),
    surface = Color.White, onBackground = Color(0xFF1E2128), onSurface = Color(0xFF1E2128),
    onSurfaceVariant = Color(0xFF565B68), surfaceVariant = Color(0xFFEAEAF1),
)
private val DarkColors = darkColorScheme(
    primary = Color(0xFF6A9BFF), onPrimary = Color(0xFF121310), background = Color(0xFF121310),
    surface = Color(0xFF20221E), onBackground = Color(0xFFE9E3D3), onSurface = Color(0xFFE9E3D3),
    onSurfaceVariant = Color(0xFFBCBAAF), surfaceVariant = Color(0xFF30332D),
)

@Composable fun SottoTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val type = Typography()
    MaterialTheme(colorScheme = if (dark) DarkColors else LightColors, typography = Typography(
        displayLarge = type.displayLarge.copy(fontFamily = FontFamily.Serif),
        headlineLarge = type.headlineLarge.copy(fontFamily = FontFamily.Serif),
        headlineMedium = type.headlineMedium.copy(fontFamily = FontFamily.Serif),
        titleLarge = type.titleLarge.copy(fontFamily = FontFamily.Serif),
    ), content = content)
}

import java.io.File
import java.security.MessageDigest
import groovy.json.JsonSlurper
import org.gradle.api.artifacts.component.ModuleComponentIdentifier
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.MapProperty
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.kotlin.serialization)
}

val signingNames = listOf("SOTTO_ANDROID_KEYSTORE_FILE", "SOTTO_ANDROID_KEYSTORE_PASSWORD",
    "SOTTO_ANDROID_KEY_ALIAS", "SOTTO_ANDROID_KEY_PASSWORD")
val signingValues = signingNames.associateWith { providers.environmentVariable(it).orNull }
val hasSigning = signingValues.values.any { it != null }
if (hasSigning) require(signingValues.values.all { !it.isNullOrBlank() }) {
    "Android release signing requires all four SOTTO_ANDROID signing variables."
}

android {
    namespace = "fm.sotto.app"
    compileSdk = 37
    defaultConfig {
        applicationId = "fm.sotto.app"
        minSdk = 26
        targetSdk = 37
        versionCode = 2
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        testInstrumentationRunnerArguments["notAnnotation"] = "fm.sotto.app.process.ExternalProcessTest"
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    if (hasSigning) signingConfigs.create("upload") {
        val selected = file(requireNotNull(signingValues["SOTTO_ANDROID_KEYSTORE_FILE"]))
        require(selected.isFile && !selected.canonicalPath.startsWith(rootProject.projectDir.parentFile.parentFile.canonicalPath + File.separator)) {
            "The Android upload keystore must be an existing file outside the checkout."
        }
        storeFile = selected
        storePassword = signingValues["SOTTO_ANDROID_KEYSTORE_PASSWORD"]
        keyAlias = signingValues["SOTTO_ANDROID_KEY_ALIAS"]
        keyPassword = signingValues["SOTTO_ANDROID_KEY_PASSWORD"]
    }
    buildTypes {
        release {
            if (hasSigning) signingConfig = signingConfigs.getByName("upload")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
    sourceSets {
        getByName("test").resources.directories.add("../../../packages/shared/fixtures/play")
        getByName("androidTest").assets.directories.add("../../../packages/shared/fixtures/play")
    }
    lint { warningsAsErrors = true }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.preview)
    implementation(libs.compose.material)
    implementation(libs.activity)
    implementation(libs.lifecycle.runtime)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.serialization)
    implementation(libs.coroutines)
    implementation(libs.camera.core)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.zxing)
    implementation(libs.okhttp)
    debugImplementation(libs.compose.tooling)
    debugImplementation(libs.compose.test.manifest)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.test)
    androidTestImplementation(libs.android.junit)
    androidTestImplementation(libs.runner)
    androidTestImplementation(libs.uiautomator)
    androidTestImplementation(libs.espresso)
}

abstract class VerifySottoLegalNotices : DefaultTask() {
    @get:InputFiles @get:PathSensitive(PathSensitivity.NONE)
    abstract val artifactFiles: ConfigurableFileCollection
    @get:Input abstract val artifactNames: MapProperty<String, String>
    @get:InputFile @get:PathSensitive(PathSensitivity.NONE)
    abstract val inventory: RegularFileProperty
    @get:InputFile @get:PathSensitive(PathSensitivity.NONE)
    abstract val sourceLicense: RegularFileProperty
    @get:InputFile @get:PathSensitive(PathSensitivity.NONE)
    abstract val sourceNotices: RegularFileProperty
    @get:InputFile @get:PathSensitive(PathSensitivity.NONE)
    abstract val bundledNotices: RegularFileProperty
    @get:InputFiles @get:PathSensitive(PathSensitivity.NAME_ONLY)
    abstract val licenseSources: ConfigurableFileCollection

    @TaskAction fun verify() {
        fun hash(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { stream ->
                val buffer = ByteArray(65536)
                while (true) {
                    val size = stream.read(buffer)
                    if (size < 0) break
                    digest.update(buffer, 0, size)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
        val expected = JsonSlurper().parse(inventory.get().asFile) as? Map<*, *>
            ?: error("Invalid Android legal inventory")
        require(expected["schema"] == 1) { "Unsupported Android legal inventory" }
        val declared = expected["artifacts"] as? List<*>
            ?: error("Missing Android legal artifact inventory")
        require(declared.all { it is String } && declared.size == declared.toSet().size) {
            "Invalid or duplicate Android legal artifacts"
        }
        val names = artifactNames.get()
        val actual = artifactFiles.files.map { file ->
            names.getValue(file.absolutePath) + "|" + hash(file)
        }.toSet()
        require(actual == declared.toSet()) {
            "Android runtime dependencies changed. Regenerate bundled license notices."
        }
        val sources = licenseSources.files.map { it.name + "|" + hash(it) }.toSet()
        val declaredSources = expected["sources"] as? List<*>
            ?: error("Missing Android legal sources inventory")
        require(sources == declaredSources.toSet() &&
            declaredSources.size == sources.size) {
            "Android legal sources changed. Regenerate bundled notices."
        }
        require(expected["rootLicense"] == hash(sourceLicense.get().asFile) &&
            expected["rootNotices"] == hash(sourceNotices.get().asFile) &&
            expected["notices"] == hash(bundledNotices.get().asFile)) {
            "Android license notices changed. Regenerate the legal inventory."
        }
    }
}

val verifyLegalNotices = tasks.register<VerifySottoLegalNotices>("verifyLegalNotices") {
    inventory.set(layout.projectDirectory.file("src/main/assets/legal/dependencies.json"))
    sourceLicense.set(rootProject.layout.projectDirectory.file("../../LICENSE"))
    sourceNotices.set(rootProject.layout.projectDirectory.file("../../THIRD_PARTY_NOTICES.md"))
    bundledNotices.set(layout.projectDirectory.file("src/main/assets/legal/notices.txt"))
    licenseSources.from(rootProject.fileTree("licenses") {
        include("*.txt", "*.json")
    })
}
androidComponents.onVariants(androidComponents.selector().withBuildType("release")) { variant ->
    val artifacts = variant.runtimeConfiguration.incoming.artifacts.resolvedArtifacts
    verifyLegalNotices.configure {
        artifactFiles.from(artifacts.map { rows -> rows.map { it.file } })
        artifactNames.set(artifacts.map { rows ->
            rows.associate { artifact ->
                val module = artifact.id.componentIdentifier as? ModuleComponentIdentifier
                    ?: error("Android legal inventory requires module artifacts")
                artifact.file.absolutePath to
                    "${module.group}:${module.module}:${module.version}|${artifact.file.name}"
            }
        })
    }
}
tasks.named("preBuild") { dependsOn(verifyLegalNotices) }

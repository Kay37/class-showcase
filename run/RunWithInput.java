import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The Java half of the Class Code Showcase's Run button. It runs inside CheerpJ.
 * Output goes to the page, and System.in asks the page for one line at a time.
 *
 *   compile <work> <path>...  copy /str/src0.java, /str/src1.java ... to <work>/src/<path>, then javac
 *                             them into <work>/classes (the old <work> is cleared first)
 *   run <work> <main class>   run that class's main from <work>/classes
 *
 * The four native methods are JavaScript functions that app.js passes to cheerpjInit.
 * Build: javac --release 17 RunWithInput.java && jar --create --file runwithinput.jar RunWithInput*.class
 */
public class RunWithInput {
    static native String readLine();               // the next line the visitor types; null = end of input
    static native void write(String text, int err); // show text in the terminal (err 1 = System.err)
    static native void done(int code);             // compile or run finished with this code

    static final PageStream OUT = new PageStream(0);
    static final PageStream ERR = new PageStream(1);

    public static void main(String[] args) throws Exception {
        System.setOut(new PrintStream(OUT, false, StandardCharsets.UTF_8));
        System.setErr(new PrintStream(ERR, false, StandardCharsets.UTF_8));
        System.setIn(new PageInput());
        startFlusher();
        int code;
        try {
            code = args[0].equals("compile") ? compile(args) : run(args[1], args[2]);
        } catch (Throwable t) {
            t.printStackTrace();
            code = 1;
        }
        System.out.flush();
        System.err.flush();
        done(code);
    }

    // Sends output that waits in a batch, every 100 ms. One thread serves every run on the page.
    static boolean flusherStarted;

    static void startFlusher() {
        if (flusherStarted) return;
        flusherStarted = true;
        Thread flusher = new Thread(() -> {
            while (true) {
                try {
                    Thread.sleep(100);
                } catch (InterruptedException e) {
                    return;
                }
                OUT.flush();
                ERR.flush();
            }
        });
        flusher.setDaemon(true);
        flusher.start();
        // System.exit() skips the end of main, so send the last batch on the way out.
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            OUT.flush();
            ERR.flush();
        }));
    }

    static int compile(String[] args) throws Exception {
        File work = new File(args[1]);
        deleteTree(work);
        File classes = new File(work, "classes");
        classes.mkdirs();
        List<String> javac = new ArrayList<>(Arrays.asList("-proc:none", "-encoding", "UTF-8", "-d", classes.getPath()));
        for (int i = 2; i < args.length; i++) {
            File to = new File(work, "src/" + args[i]);
            to.getParentFile().mkdirs();
            try (InputStream in = new FileInputStream("/str/src" + (i - 2) + ".java");
                 OutputStream out = new FileOutputStream(to)) {
                in.transferTo(out);
            }
            javac.add(to.getPath());
        }
        Method compile = Class.forName("com.sun.tools.javac.Main").getMethod("compile", String[].class);
        return (Integer) compile.invoke(null, (Object) javac.toArray(new String[0]));
    }

    static int run(String work, String mainClass) throws Exception {
        // A new class loader each run, so a second project on the same page never sees the first one's classes.
        URL classes = new File(work, "classes").toURI().toURL();
        ClassLoader loader = new URLClassLoader(new URL[] {classes}, RunWithInput.class.getClassLoader());
        Thread.currentThread().setContextClassLoader(loader);
        Method main = Class.forName(mainClass, true, loader).getMethod("main", String[].class);
        main.setAccessible(true);
        try {
            main.invoke(null, (Object) new String[0]);
            return 0;
        } catch (InvocationTargetException e) {
            Throwable t = e.getCause();
            t.setStackTrace(userFrames(t.getStackTrace()));
            System.out.flush();
            System.err.print("Exception in thread \"main\" ");
            t.printStackTrace();
            return 1;
        }
    }

    // Drop the frames below the program's own main (reflection and this class).
    static StackTraceElement[] userFrames(StackTraceElement[] frames) {
        int end = frames.length;
        for (int i = 0; i < frames.length; i++) {
            String c = frames[i].getClassName();
            if (c.startsWith("jdk.internal.reflect.") || c.startsWith("java.lang.reflect.") || c.equals("RunWithInput")) {
                end = i;
                break;
            }
        }
        return Arrays.copyOf(frames, end);
    }

    static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    /**
     * Collects bytes and sends them to the page in batches: each call to the page is slow, so a println per
     * call would make a counting loop crawl. A batch goes when 50 ms have passed, at 8 KB, before input,
     * and every 100 ms from the flusher thread. One lock for both streams keeps out and err in order.
     */
    static final class PageStream extends OutputStream {
        private static final Object LOCK = new Object();
        private final int err;
        private final ByteArrayOutputStream buf = new ByteArrayOutputStream();
        private long lastFlush = System.nanoTime();

        PageStream(int err) { this.err = err; }

        @Override public void write(int b) {
            synchronized (LOCK) {
                other().flush();
                buf.write(b);
                maybeFlush();
            }
        }

        @Override public void write(byte[] b, int off, int len) {
            synchronized (LOCK) {
                other().flush();
                buf.write(b, off, len);
                maybeFlush();
            }
        }

        private PageStream other() { return this == OUT ? ERR : OUT; }

        private void maybeFlush() {
            if (buf.size() >= 8192 || System.nanoTime() - lastFlush > 50_000_000L) flush();
        }

        @Override public void flush() {
            synchronized (LOCK) {
                send();
            }
        }

        private void send() {
            lastFlush = System.nanoTime();
            if (buf.size() == 0) return;
            byte[] bytes = buf.toByteArray();
            int end = bytes.length;
            // Keep a character that is cut in half for the next flush.
            int start = end - 1;
            while (start > 0 && start > end - 4 && (bytes[start] & 0xC0) == 0x80) start--;
            int lead = bytes[start] & 0xFF;
            int need = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC0 ? 2 : 1;
            if (end - start < need) end = start;
            buf.reset();
            buf.write(bytes, end, bytes.length - end);
            if (end > 0) RunWithInput.write(new String(bytes, 0, end, StandardCharsets.UTF_8), err);
        }
    }

    /** System.in: asks the page for a line only when the program wants more input. */
    static final class PageInput extends InputStream {
        private byte[] line = new byte[0];
        private int pos;
        private boolean ended;

        private boolean fill() {
            if (pos < line.length) return true;
            if (ended) return false;
            System.out.flush(); // so "Name? " shows before the input box
            System.err.flush();
            String s = readLine();
            if (s == null) {
                ended = true;
                return false;
            }
            line = (s + "\n").getBytes(StandardCharsets.UTF_8);
            pos = 0;
            return true;
        }

        @Override public synchronized int read() {
            return fill() ? line[pos++] & 0xFF : -1;
        }

        @Override public synchronized int read(byte[] b, int off, int len) {
            if (len == 0) return 0;
            if (!fill()) return -1;
            int n = Math.min(len, line.length - pos);
            System.arraycopy(line, pos, b, off, n);
            pos += n;
            return n;
        }

        @Override public synchronized int available() {
            return line.length - pos;
        }
    }
}

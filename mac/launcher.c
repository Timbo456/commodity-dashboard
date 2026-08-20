#define _POSIX_C_SOURCE 200809L
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <pwd.h>
#include <errno.h>
#include <mach-o/dyld.h>

int main(int argc, char *argv[]) {
    // Get the path to this executable using macOS API
    char exe_path[4096];
    uint32_t size = sizeof(exe_path);
    if (_NSGetExecutablePath(exe_path, &size) != 0) {
        // Buffer too small, fallback to realpath of argv[0]
        if (!realpath(argv[0], exe_path)) {
            exe_path[0] = '\0';
        }
    }

    // Walk up 3 levels: launcher -> MacOS -> Contents (bundle root)
    char dir[4096];
    strcpy(dir, exe_path);
    
    // Remove "launcher" -> .../Contents/MacOS
    char *sl = strrchr(dir, '/');
    if (sl) *sl = '\0';
    
    // Remove "MacOS" -> .../Contents (bundle root)
    sl = strrchr(dir, '/');
    if (sl) *sl = '\0';

    // launch.sh is in Contents/Resources
    char script_path[4096];
    snprintf(script_path, sizeof(script_path), "%s/Resources/launch.sh", dir);

    // Find bash
    char *bash_paths[] = {"/bin/bash", "/usr/bin/bash", NULL};
    char *bash = NULL;
    for (int i = 0; bash_paths[i]; i++) {
        if (access(bash_paths[i], X_OK) == 0) {
            bash = bash_paths[i];
            break;
        }
    }
    if (!bash) bash = "/bin/bash";

    // Set HOME for GUI launch (required by launch.sh with set -u)
    if (!getenv("HOME")) {
        struct passwd *pw = getpwuid(getuid());
        if (pw) setenv("HOME", pw->pw_dir, 1);
    }

    // Set PATH for GUI launch (includes Python framework path)
    setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin:"
                   "/Library/Frameworks/Python.framework/Versions/3.13/bin:"
                   "/opt/homebrew/bin:/usr/local/bin", 0);

    // Make script executable
    chmod(script_path, 0755);

    // Exec bash with the launch script
    char **new_argv = malloc(sizeof(char *) * (argc + 3));
    new_argv[0] = bash;
    new_argv[1] = script_path;
    for (int i = 0; i < argc; i++) {
        new_argv[i + 2] = argv[i];
    }
    new_argv[argc + 2] = NULL;

    execv(bash, new_argv);
    return 1; // Should never reach here on success
}

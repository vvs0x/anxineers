using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Anxineers.Core
{
    /// <summary>
    /// Lives in the Boot scene. Waits one frame so XR can initialize, then loads the first real scene.
    /// </summary>
    public class BootLoader : MonoBehaviour
    {
        [SerializeField] private string firstScene = "Sandbox";

        private IEnumerator Start()
        {
            yield return null;
            SceneManager.LoadScene(firstScene);
        }
    }
}
